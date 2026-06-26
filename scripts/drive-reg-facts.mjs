// For every client with files in their Drive "Company Documents" folder, download
// each file, ask OpenAI to extract registration facts (trade licence no/expiry,
// establishment date, VAT TRN, CT TRN, free-zone authority), and merge the
// results into clients.reg_facts (+ trade_licence_no and vat_trn columns).
// Idempotent: never overwrites a manually-entered field; only fills blanks
// unless --force is passed.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import dns from "node:dns";

// Force IPv4 — googleapis IPv6 routing is flaky on this box.
dns.setDefaultResultOrder("ipv4first");

const rawFetch = globalThis.fetch;
async function safeFetch(url, opts, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await rawFetch(url, opts);
    } catch (e) {
      lastErr = e;
      console.error(`  fetch attempt ${i+1} failed: ${e.message?.slice(0,80) ?? "?"}`);
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

const FORCE = process.argv.includes("--force");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function decryptSecret(payload) {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  const key = Buffer.from(raw, "base64");
  const [ivb, tagb, encb] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encb, "base64")), decipher.final()]).toString("utf8");
}
function encryptSecret(text) {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  const key = Buffer.from(raw, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

const { data: org } = await db.from("orgs").select("id,name").order("created_at").limit(1).single();
const { data: ai } = await db.from("ai_settings").select("openai_key_enc,feature_models").eq("org_id", org.id).maybeSingle();
const openaiKey = decryptSecret(ai.openai_key_enc);

const { data: gconn } = await db.from("member_connections").select("team_member_id")
  .eq("provider", "google").eq("connected", true).eq("org_id", org.id).limit(1).maybeSingle();
if (!gconn) { console.error("No Google connection"); process.exit(1); }
const tmId = gconn.team_member_id;

async function getToken() {
  const { data } = await db.from("member_connections")
    .select("access_token_enc,refresh_token_enc,token_expiry")
    .eq("team_member_id", tmId).eq("provider", "google").maybeSingle();
  const expired = data.token_expiry ? new Date(data.token_expiry).getTime() < Date.now() + 60_000 : true;
  if (!expired) return decryptSecret(data.access_token_enc);
  const refresh = decryptSecret(data.refresh_token_enc);
  const r = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const tok = await r.json();
  if (!tok.access_token) throw new Error("token refresh failed: " + JSON.stringify(tok));
  await db.from("member_connections").update({
    access_token_enc: encryptSecret(tok.access_token),
    token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("team_member_id", tmId).eq("provider", "google");
  return tok.access_token;
}

async function listFolder(token, parentId) {
  const r = await safeFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return [];
  return (await r.json()).files ?? [];
}
async function findSub(token, parentId, name) {
  const safe = name.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false and '${parentId}' in parents`;
  const r = await safeFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return null;
  return (await r.json()).files?.[0] ?? null;
}
async function listClientDocs(token, clientRootId) {
  const sub = await findSub(token, clientRootId, "Company Documents");
  const baseId = sub?.id ?? clientRootId;
  const out = [];
  const walk = async (folderId, depth) => {
    if (depth > 3) return;
    for (const f of await listFolder(token, folderId)) {
      if (f.mimeType?.includes("folder")) await walk(f.id, depth + 1);
      else out.push(f);
    }
  };
  await walk(baseId, 0);
  return out;
}
async function downloadFile(token, fileId) {
  const r = await safeFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

function isImageMime(m) {
  return /image\/(jpeg|jpg|png|webp|gif|heic|heif)/i.test(m ?? "");
}
function isImageName(n) {
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(n ?? "");
}

// Extract from PDF (input_file) or image (input_image)
async function extractFromFile(buf, filename, mimeType, clientName) {
  const isImg = isImageMime(mimeType) || isImageName(filename);
  const prompt =
    `Extract registration facts from this document for "${clientName}". Output ONLY JSON: ` +
    `{"doc_type":"trade_licence|moa|vat_certificate|ct_certificate|passport|emirates_id|coi|other",` +
    `"trade_licence_no":"","licence_expiry":"YYYY-MM-DD","incorporation_date":"YYYY-MM-DD",` +
    `"vat_trn":"","vat_effective_date":"YYYY-MM-DD","ct_trn":"","ct_effective_date":"YYYY-MM-DD",` +
    `"free_zone":"e.g. DMCC|JAFZA|IFZA|RAKEZ|Meydan|DAFZA|SHAMS|...",` +
    `"jurisdiction":"e.g. Dubai|Abu Dhabi|Sharjah|...","emirate":"",` +
    `"financial_year_end":"YYYY-MM-DD","share_capital":"","activity":""}. ` +
    `Use ONLY what's in the document. Omit any field that isn't clearly present (do not invent or write 'unknown').`;

  let content;
  if (isImg) {
    const ext = (filename.split(".").pop() ?? "jpeg").toLowerCase();
    const mime = ext.startsWith("png") ? "image/png" : ext.startsWith("gif") ? "image/gif" : ext.startsWith("webp") ? "image/webp" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    content = [
      { type: "input_text", text: prompt },
      { type: "input_image", image_url: dataUrl },
    ];
  } else {
    // Upload then reference via file_id
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buf)], { type: mimeType || "application/pdf" });
    form.append("file", blob, filename);
    form.append("purpose", "user_data");
    const up = await safeFetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!up.ok) return { error: `upload ${up.status}: ${(await up.text()).slice(0,200)}` };
    const fileId = (await up.json()).id;
    content = [
      { type: "input_text", text: prompt },
      { type: "input_file", file_id: fileId },
    ];
  }

  const r = await safeFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      input: [{ role: "user", content }],
      max_output_tokens: 800,
    }),
  });
  if (!r.ok) return { error: `responses ${r.status}: ${(await r.text()).slice(0,200)}` };
  const j = await r.json();
  const text = (j.output_text ?? j.output?.[0]?.content?.[0]?.text ?? "").toString();
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return { raw: text.slice(0, 200) };
  try { return JSON.parse(text.slice(s, e + 1)); }
  catch { return { raw: text.slice(0, 200) }; }
}

function mergeFacts(into, incoming, force) {
  const merged = { ...(into ?? {}) };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (!v || v === "unknown") continue;
    if (k === "doc_type") continue;
    if (force || !merged[k]) merged[k] = v;
  }
  return merged;
}

// ---- main ----
const token = await getToken();
console.log("Google token ready.");

const { data: clients } = await db.from("clients")
  .select("id,name,trade_licence_no,vat_trn,reg_facts")
  .eq("org_id", org.id).order("name");
const { data: dfs } = await db.from("drive_folders").select("client_id,tree");
const dfBy = new Map((dfs ?? []).map((r) => [r.client_id, r.tree]));

const report = [];
for (const c of clients) {
  const tree = dfBy.get(c.id);
  if (!tree?.id) { report.push({ client: c.name.slice(0,40), status: "no_folder" }); continue; }
  const docs = await listClientDocs(token, tree.id);
  // Skip files that are clearly Finanshels proposals (we want client docs)
  const useful = docs.filter((d) => !/proposal|finanshels|contract-finanshels/i.test(d.name));
  if (!useful.length) { report.push({ client: c.name.slice(0,40), status: "no_docs", docs: docs.length }); continue; }

  const merged = { ...((c.reg_facts ?? {})) };
  const docTypes = new Map(); // doc_type → fact source
  const errors = [];
  for (const d of useful) {
    if (d.mimeType === "application/vnd.google-apps.document" ||
        d.mimeType === "application/vnd.google-apps.spreadsheet") continue; // skip Google-format
    const buf = await downloadFile(token, d.id);
    if (!buf) { errors.push(`dl_fail: ${d.name}`); continue; }
    if (buf.length > 30 * 1024 * 1024) { errors.push(`too_big: ${d.name}`); continue; }
    const ex = await extractFromFile(buf, d.name, d.mimeType, c.name);
    if (ex.error) { errors.push(`${d.name}: ${ex.error.slice(0,60)}`); continue; }
    docTypes.set(d.name, ex.doc_type ?? "?");
    Object.assign(merged, mergeFacts(merged, ex, FORCE));
  }

  const updates = {};
  // Lift specific fields into top-level columns when the AI found them
  if ((!c.trade_licence_no || FORCE) && merged.trade_licence_no) updates.trade_licence_no = String(merged.trade_licence_no);
  if ((!c.vat_trn || FORCE) && merged.vat_trn) updates.vat_trn = String(merged.vat_trn);
  if (Object.keys(merged).length) updates.reg_facts = merged;
  if (Object.keys(updates).length) {
    const { error } = await db.from("clients").update(updates).eq("id", c.id);
    if (error) errors.push("db_err: " + error.message);
  }
  report.push({
    client: c.name.slice(0, 40),
    status: errors.length ? "partial" : "ok",
    docs: useful.length,
    fields: Object.keys(merged).length,
    trade_lic: merged.trade_licence_no ? "Y" : "-",
    vat_trn: merged.vat_trn ? "Y" : "-",
    expiry: merged.licence_expiry ? "Y" : "-",
    errors: errors.slice(0, 2).join(" | "),
  });
}
console.table(report);
const okCount = report.filter((r) => r.status === "ok" || r.status === "partial").length;
console.log(`\n${okCount} clients had docs processed.`);
