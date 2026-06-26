// Preview-only: refresh Munees's Google token, then list files in every client's
// drive_folders.tree.id (looking for a "Company Documents" sub-folder first).
// Doesn't write anything — just shows what's discoverable.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

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

async function refreshGoogle(tmId) {
  const { data } = await db.from("member_connections")
    .select("access_token_enc,refresh_token_enc,token_expiry")
    .eq("team_member_id", tmId).eq("provider", "google").maybeSingle();
  if (!data) return null;
  const expired = data.token_expiry ? new Date(data.token_expiry).getTime() < Date.now() + 60_000 : true;
  if (!expired) return decryptSecret(data.access_token_enc);
  const refresh = decryptSecret(data.refresh_token_enc);
  const r = await fetch("https://oauth2.googleapis.com/token", {
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
  if (!tok.access_token) { console.error("refresh failed:", tok); return null; }
  await db.from("member_connections").update({
    access_token_enc: encryptSecret(tok.access_token),
    token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("team_member_id", tmId).eq("provider", "google");
  console.log("Refreshed Google token, expires in", tok.expires_in, "s");
  return tok.access_token;
}

async function listFolder(token, parentId) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0,200)}` };
  return { files: (await r.json()).files ?? [] };
}

async function findSub(token, parentId, name) {
  const safe = name.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false and '${parentId}' in parents`;
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return null;
  return (await r.json()).files?.[0] ?? null;
}

// ---- main ----
const { data: gconn } = await db.from("member_connections").select("team_member_id")
  .eq("provider", "google").eq("connected", true).limit(1).maybeSingle();
if (!gconn) { console.error("No google connection"); process.exit(1); }
const token = await refreshGoogle(gconn.team_member_id);
if (!token) { console.error("Couldn't get a token"); process.exit(1); }

const { data: clients } = await db.from("clients").select("id,name").order("name");
const { data: dfs } = await db.from("drive_folders").select("client_id,tree");
const dfBy = new Map((dfs ?? []).map((r) => [r.client_id, r.tree]));

const report = [];
for (const c of clients) {
  const tree = dfBy.get(c.id);
  if (!tree?.id) { report.push({ client: c.name.slice(0,40), folder: "(none)", docs: 0 }); continue; }
  // First check Company Documents sub-folder
  const sub = await findSub(token, tree.id, "Company Documents");
  const targetId = sub?.id ?? tree.id;
  const { files, error } = await listFolder(token, targetId);
  if (error) { report.push({ client: c.name.slice(0,40), folder: targetId.slice(0,10), error: error.slice(0,40) }); continue; }
  const docs = (files ?? []).filter((f) => !f.mimeType?.includes("folder"));
  const folders = (files ?? []).filter((f) => f.mimeType?.includes("folder"));
  // Walk into sub-folders one level
  for (const sf of folders) {
    const sub2 = await listFolder(token, sf.id);
    if (sub2.files) for (const f of sub2.files) if (!f.mimeType?.includes("folder")) docs.push({ ...f, name: `${sf.name}/${f.name}` });
  }
  report.push({
    client: c.name.slice(0, 40), folder: sub ? "Company Documents" : "(root)",
    docs: docs.length,
    sample: docs.slice(0, 3).map(d => d.name.slice(0, 35)).join(" | "),
  });
}
console.table(report);
const total = report.reduce((n, r) => n + (r.docs ?? 0), 0);
console.log(`\nTotal docs across all clients: ${total}`);
