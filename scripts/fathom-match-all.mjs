// Two-pass Fathom matcher with paginated, throttled fetch.
//   Phase 1: list ALL meetings (no transcript) across pages with 429-aware backoff.
//   Phase 2: per client, choose best meeting by share_link → distinctive token → email domain.
//   Phase 3: for matched meetings only, fetch transcript (with throttle) and persist
//            client_meetings + clients.call_link/notes.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const GENERIC = new Set([
  "the","group","trading","general","services","limited","company","global","international",
  "middle","east","consulting","consultancy","consultancies","technology","technologies","capital",
  "human","resources","real","estate","strategic","advertising","equipment","auctions","commodity",
  "energy","business","reunion","seed","olive","facilitation","treatment","medical","rescue",
  "manufacturing","products","daily","fresh","bakery","freight","stream","border","cross",
  "advisory","management","traders","industries","fze","llc","fzco","fz","corp","ltd","co","l.l.c",
  "with","onboarding","meeting","call","kickoff","intro","sync","check","update","review","first",
  "free","zone","mainland","emirates","dubai","abu","sharjah","ajman","ras","khaimah","oman",
  "client","customer","handover","accounts","accounting","catchup","catch","up",
]);

function decryptSecret(payload) {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  const key = Buffer.from(raw, "base64");
  const [ivb, tagb, encb] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encb, "base64")), decipher.final()]).toString("utf8");
}

function asText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((seg) => {
      if (typeof seg === "string") return seg;
      const who = seg?.speaker ?? seg?.speaker_name ?? seg?.name ?? seg?.assignee_name;
      const txt = seg?.text ?? seg?.description ?? seg?.title ?? seg?.markdown;
      return [who, txt].filter(Boolean).join(": ");
    }).filter(Boolean).join("\n");
  }
  if (typeof v === "object") return v?.markdown ?? v?.text ?? v?.summary ?? "";
  return String(v);
}

function notesFrom(m) {
  const parts = [];
  const s = asText(m.default_summary); if (s) parts.push("Summary:\n" + s);
  const a = asText(m.action_items);    if (a) parts.push("Action items:\n" + a);
  const t = asText(m.transcript);      if (t) parts.push("Transcript:\n" + t);
  return parts.join("\n\n").slice(0, 28000);
}

function meetingEmails(m) {
  const out = new Set();
  const scan = (arr) => (arr ?? []).forEach((p) => { if (p?.email) out.add(String(p.email).toLowerCase()); });
  scan(m.invitees); scan(m.participants); scan(m.attendees);
  return [...out];
}

function clientTokens(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 6 && !GENERIC.has(w));
}

function matchByShareLink(meeting, link) {
  if (!link) return false;
  if (meeting.share_url === link || meeting.url === link) return true;
  const tok = link.split("/").pop();
  return !!tok && (meeting.share_url?.includes(tok) || meeting.url?.includes(tok));
}

function meetingId(m) { return m.recording_id ?? m.id ?? m.share_url ?? m.url ?? JSON.stringify(m).slice(0,40); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fathomGET(apiKey, url, attempt = 0) {
  const r = await fetch(url, { headers: { "X-Api-Key": apiKey } });
  if (r.status === 429) {
    if (attempt >= 6) throw new Error("Rate limited too many times");
    const retryAfter = Number(r.headers.get("retry-after")) || (3 + attempt * 3);
    console.log(`  429 — backing off ${retryAfter}s (attempt ${attempt + 1})`);
    await sleep(retryAfter * 1000);
    return fathomGET(apiKey, url, attempt + 1);
  }
  if (!r.ok) throw new Error(`Fathom ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ---------------- main ----------------
const { data: org } = await db.from("orgs").select("id,name").order("created_at").limit(1).single();
const orgId = org.id;

const { data: fconn } = await db
  .from("member_connections").select("config")
  .eq("provider", "fathom").eq("connected", true).eq("org_id", orgId).limit(1).maybeSingle();
if (!fconn?.config?.key_enc) { console.error("No Fathom key connected."); process.exit(1); }
const apiKey = decryptSecret(fconn.config.key_enc);

// Phase 1: paginate list (no transcript)
console.log("Phase 1: paginating Fathom list…");
const meetings = [];
let cursor = null;
for (let page = 0; page < 100; page++) {
  const url = new URL("https://api.fathom.ai/external/v1/meetings");
  url.searchParams.set("limit", "50");
  if (cursor) url.searchParams.set("cursor", cursor);
  const j = await fathomGET(apiKey, url);
  const items = j.items ?? j.meetings ?? [];
  meetings.push(...items);
  cursor = j.next_cursor ?? j.cursor ?? null;
  console.log(`  page ${page + 1}: +${items.length} (total ${meetings.length})  next=${cursor ? "yes" : "no"}`);
  if (!cursor || items.length === 0) break;
  await sleep(800);
}
console.log(`Phase 1 done: ${meetings.length} meetings.\n`);

// Load clients
const { data: clients, error: cErr } = await db
  .from("clients").select("id,name,primary_contact_email,call_link,call_notes").eq("org_id", orgId);
if (cErr) { console.error(cErr); process.exit(1); }
console.log(`Clients: ${clients.length}\n`);

// Phase 2: match
const matches = new Map();
const claimed = new Set();
for (const c of clients) {
  if (!c.call_link) continue;
  const m = meetings.find((x) => matchByShareLink(x, c.call_link));
  if (m) { matches.set(c.id, { m, how: "share_link" }); claimed.add(meetingId(m)); }
}
for (const c of clients) {
  if (matches.has(c.id)) continue;
  const tokens = clientTokens(c.name);
  if (!tokens.length) continue;
  const candidates = meetings.filter((m) => {
    if (claimed.has(meetingId(m))) return false;
    const title = (m.title ?? m.meeting_title ?? "").toLowerCase();
    if (!title) return false;
    return tokens.some((t) => title.includes(t));
  });
  if (!candidates.length) continue;
  // Prefer the most-recent
  candidates.sort((a, b) => (b.scheduled_start_time ?? b.created_at ?? "").localeCompare(a.scheduled_start_time ?? a.created_at ?? ""));
  const m = candidates[0];
  matches.set(c.id, { m, how: "title" });
  claimed.add(meetingId(m));
}
for (const c of clients) {
  if (matches.has(c.id)) continue;
  const cEmail = (c.primary_contact_email ?? "").toLowerCase();
  if (!cEmail.includes("@")) continue;
  const domain = cEmail.split("@")[1];
  if (!domain || ["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com"].includes(domain)) continue;
  const candidates = meetings.filter((m) => {
    if (claimed.has(meetingId(m))) return false;
    return meetingEmails(m).some((e) => e.endsWith("@" + domain));
  });
  if (!candidates.length) continue;
  const m = candidates[0];
  matches.set(c.id, { m, how: "email_domain" });
  claimed.add(meetingId(m));
}

// Phase 3: fetch transcript per matched meeting (throttled) & persist
console.log("Phase 3: fetching transcripts for matched meetings…");
const report = [];
for (const c of clients) {
  const hit = matches.get(c.id);
  if (!hit) { report.push({ client: c.name.slice(0,42), how: "—", chars: 0, status: "no_match" }); continue; }
  const { m: meta, how } = hit;
  const id = meta.recording_id ?? meta.id;
  let full = meta;
  if (id) {
    try {
      // Try per-meeting fetch with transcript=true (endpoint variants)
      const url = new URL(`https://api.fathom.ai/external/v1/meetings/${id}`);
      url.searchParams.set("include_transcript", "true");
      full = await fathomGET(apiKey, url);
    } catch (e) {
      // Fall back to a list-page with include_transcript that contains this id
      try {
        const url = new URL("https://api.fathom.ai/external/v1/meetings");
        url.searchParams.set("include_transcript", "true");
        url.searchParams.set("limit", "10");
        const j = await fathomGET(apiKey, url);
        const items = j.items ?? [];
        full = items.find((x) => meetingId(x) === meetingId(meta)) ?? meta;
      } catch {
        // give up; use list metadata
        full = meta;
      }
    }
    await sleep(1200);
  }

  const shareUrl = full.share_url ?? full.url ?? meta.share_url ?? c.call_link ?? "";
  const notes = notesFrom(full);
  const title = full.title ?? full.meeting_title ?? meta.title ?? `${c.name} — call`;
  const meetingDate = full.scheduled_start_time ?? full.meeting_time ?? full.created_at ?? null;

  const updates = {};
  if (!c.call_link && shareUrl) updates.call_link = shareUrl;
  if (notes && (!c.call_notes || c.call_notes.length < Math.floor(notes.length / 2))) updates.call_notes = notes;
  if (Object.keys(updates).length) {
    const { error } = await db.from("clients").update(updates).eq("id", c.id);
    if (error) { report.push({ client: c.name.slice(0,42), how, chars: notes.length, status: `db_err: ${error.message}` }); continue; }
  }

  let meetingStatus = "no_meeting_row";
  if (notes && shareUrl) {
    const { data: existing } = await db.from("client_meetings")
      .select("id").eq("client_id", c.id).eq("recording_link", shareUrl).maybeSingle();
    if (existing) {
      const { error: uErr } = await db.from("client_meetings").update({
        title, notes, meeting_date: meetingDate ? meetingDate.slice(0,10) : null,
      }).eq("id", existing.id);
      meetingStatus = uErr ? `m_upd_err: ${uErr.message}` : "m_updated";
    } else {
      const { error: iErr } = await db.from("client_meetings").insert({
        org_id: orgId, client_id: c.id, title,
        meeting_date: meetingDate ? meetingDate.slice(0,10) : null,
        recording_link: shareUrl, notes, summary: null,
        source: "fathom", created_by: "fathom-match-all",
      });
      meetingStatus = iErr ? `m_ins_err: ${iErr.message}` : "m_inserted";
    }
  }

  report.push({
    client: c.name.slice(0, 42), how, chars: notes.length,
    title: (title ?? "").slice(0, 46),
    status: meetingStatus,
  });
}

console.table(report);
const matched = report.filter((r) => r.how !== "—").length;
console.log(`\nMatched ${matched}/${clients.length} clients. ${meetings.length - claimed.size} Fathom meetings unmatched.`);

const unclaimed = meetings.filter((m) => !claimed.has(meetingId(m))).slice(0, 200);
if (unclaimed.length) {
  console.log("\nUnclaimed Fathom meetings (first 200):");
  for (const m of unclaimed) {
    const t = (m.title ?? m.meeting_title ?? "(no title)").slice(0,70);
    console.log(`  • ${t}`);
  }
}
