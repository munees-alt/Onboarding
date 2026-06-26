// Backfill: save Fathom recording links + raw notes for the 6 named clients.
// Notes come from the Fathom API using the org's stored Fathom key.
// Run: node --env-file=.env.local scripts/backfill-fathom-links.mjs
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const PAIRS = [
  ["Al Hussein",      "https://fathom.video/share/TH_trzx64y97ydkB_yvEwia8kxY1vkNp"],
  ["Stream Freight",  "https://fathom.video/share/tHFX75_xZvAFT6FBCLtwHL5WGsNwZkFR"],
  ["Trinovate",       "https://fathom.video/share/U4siCmNVf66393pJvGRkt8qBNk7ku3hs"],
  ["Altaryon",        "https://fathom.video/share/61sxmGN9G9pqEfh4FLsyeFY8-CY2bJ7z"],
  ["Fresh Daily",     "https://fathom.video/share/feUF4wYEqqus6qTyq4wzakNbLjUynpvk"],
  ["Avobar",          "https://fathom.video/share/Rkk129x64PKAZVae7Erq8jHZPGBSzJcg"],
];

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

function asText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((seg) => {
      if (typeof seg === "string") return seg;
      const who = seg?.speaker ?? seg?.speaker_name ?? seg?.name;
      const txt = seg?.text ?? seg?.description ?? seg?.title ?? seg?.markdown;
      return [who, txt].filter(Boolean).join(": ");
    }).filter(Boolean).join("\n");
  }
  if (typeof v === "object") return v?.markdown ?? v?.text ?? v?.summary ?? JSON.stringify(v);
  return String(v);
}

// Pull every meeting once, then look up per client by share URL or title match.
async function fetchAllMeetings(apiKey) {
  const res = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true", {
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Fathom API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.items ?? j.meetings ?? [];
}

function meetingMatchesShareUrl(m, url) {
  if (!url) return false;
  const token = url.split("/").pop() ?? "";
  return m.share_url === url || m.url === url || (token && (m.share_url?.includes(token) || m.url?.includes(token)));
}

function meetingMatchesClient(m, clientName) {
  const title = (m.title ?? m.meeting_title ?? "").toLowerCase();
  return title.includes(clientName.toLowerCase().slice(0, 10));
}

function notesFrom(m) {
  const parts = [];
  const s = asText(m.default_summary); if (s) parts.push("Summary:\n" + s);
  const a = asText(m.action_items);    if (a) parts.push("Action items:\n" + a);
  const t = asText(m.transcript);      if (t) parts.push("Transcript:\n" + t);
  return parts.join("\n\n").slice(0, 28000);
}

// --- main ---------------------------------------------------------------
const { data: org } = await db.from("orgs").select("id").order("created_at").limit(1).single();
const orgId = org.id;

const { data: fconn } = await db
  .from("member_connections").select("config")
  .eq("provider", "fathom").eq("connected", true).eq("org_id", orgId).limit(1).maybeSingle();
if (!fconn?.config?.key_enc) {
  console.error("No connected Fathom key found in member_connections for this org.");
  process.exit(1);
}
const apiKey = decryptSecret(fconn.config.key_enc);
console.log("Fathom key loaded.");

const meetings = await fetchAllMeetings(apiKey);
console.log(`Fathom returned ${meetings.length} meetings.`);

let okCount = 0;
const report = [];
for (const [nameLike, shareUrl] of PAIRS) {
  const { data: client } = await db
    .from("clients").select("id,name")
    .eq("org_id", orgId)
    .ilike("name", `%${nameLike}%`)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!client) { report.push({ nameLike, status: "client_not_found" }); continue; }

  let m = meetings.find((x) => meetingMatchesShareUrl(x, shareUrl));
  if (!m) m = meetings.find((x) => meetingMatchesClient(x, nameLike));
  const notes = m ? notesFrom(m) : "";

  const { error } = await db.from("clients").update({
    call_link: shareUrl,
    ...(notes ? { call_notes: notes } : {}),
  }).eq("id", client.id);
  if (error) { report.push({ nameLike, status: `db_error: ${error.message}` }); continue; }

  // Also populate client_meetings so the Meetings tab actually shows it. Dedupe by
  // recording_link so re-running this script is idempotent.
  let meetingStatus = "no_meeting_row";
  if (notes) {
    const { data: existing } = await db.from("client_meetings")
      .select("id").eq("client_id", client.id).eq("recording_link", shareUrl).maybeSingle();
    if (existing) {
      meetingStatus = "meeting_already_present";
    } else {
      const meetingTitle = (m && (m.title || m.meeting_title)) || `${client.name} — call`;
      const { error: mErr } = await db.from("client_meetings").insert({
        org_id: orgId,
        client_id: client.id,
        title: meetingTitle,
        meeting_date: null,
        recording_link: shareUrl,
        notes,
        summary: null,           // AI summary intentionally skipped — user can refresh from UI
        source: "fathom",
        created_by: "backfill script",
      });
      meetingStatus = mErr ? `meeting_db_error: ${mErr.message}` : "meeting_inserted";
    }
  }

  report.push({
    nameLike, clientName: client.name,
    fathomMatched: !!m,
    notesChars: notes.length,
    status: m ? (notes ? "ok" : "matched_but_empty") : "no_fathom_match",
    meeting: meetingStatus,
  });
  if (m && notes) okCount++;
}

console.log("\nResults:");
console.table(report);
console.log(`\n${okCount} / ${PAIRS.length} clients backfilled with link + Fathom notes.`);
console.log("Tip: open each playbook and click 'Extract insights' to run the AI analysis on the saved notes.");
