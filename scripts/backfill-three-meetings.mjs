// Pulls 3 specific Fathom recordings (by share URL) into client_meetings + runs
// the full insight extractor on each so the playbook gets populated.
// Run: node --env-file=.env.local scripts/backfill-three-meetings.mjs
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const TARGETS = [
  { client: "Cross Border", url: "https://fathom.video/share/TLHhxGuHDdoADWPdnc49F6_GcEe8RwHw" },
  { client: "BSK IT",       url: "https://fathom.video/share/9B6LmsxXfkk9WtFjYT2APncYb_8KLrBG" },
  { client: "Emargrow",     url: "https://fathom.video/share/Tox_BqPdCvPEWMWPon6g7qAy46wm-zHL" },
];

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function decrypt(payload) {
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const [iv, tag, ct] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

const { data: org } = await db.from("orgs").select("id").limit(1).single();
const orgId = org.id;
const { data: fc } = await db.from("member_connections").select("config").eq("provider", "fathom").eq("connected", true).eq("org_id", orgId).limit(1).maybeSingle();
const apiKey = decrypt(fc.config.key_enc);

async function fetchSpecific(shareUrl) {
  const res = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true", { headers: { "X-Api-Key": apiKey } });
  if (!res.ok) throw new Error("fathom " + res.status);
  const j = await res.json();
  const items = j.items || j.meetings || [];
  const token = shareUrl.split("/").pop();
  return items.find((m) => m.share_url === shareUrl || m.url === shareUrl || (token && (m.share_url?.includes(token) || m.url?.includes(token))));
}

function asText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((seg) => {
      if (typeof seg === "string") return seg;
      const o = seg ?? {};
      const txt = o.text ?? o.description ?? o.title ?? o.markdown;
      const who = o.assignee_name ?? o.assignee ?? o.owner ?? o.speaker ?? o.speaker_name ?? o.name;
      const due = o.due_date ?? o.due_at ?? o.due ?? o.deadline;
      if (!txt && !who) return "";
      const meta = [who, due ? `due ${String(due).slice(0, 10)}` : ""].filter(Boolean).join(" · ");
      return meta ? `• ${txt ?? ""} — ${meta}` : `• ${txt ?? ""}`;
    }).filter(Boolean).join("\n");
  }
  if (typeof v === "object") return v.markdown ?? v.text ?? v.summary ?? JSON.stringify(v);
  return String(v);
}
function notesFrom(m) {
  const parts = [];
  const s = asText(m.default_summary); if (s) parts.push("Summary:\n" + s);
  const a = asText(m.action_items);    if (a) parts.push("Action items:\n" + a);
  const t = asText(m.transcript);      if (t) parts.push("Transcript:\n" + t);
  return parts.join("\n\n").slice(0, 28000);
}

for (const tgt of TARGETS) {
  console.log(`\n=== ${tgt.client} ===`);
  const { data: clients } = await db.from("clients").select("id,name").eq("org_id", orgId).ilike("name", `%${tgt.client}%`);
  if (!clients?.length) { console.log("  ⚠️  no matching client"); continue; }
  // Pick the longest-named match (Cross Border Consultancy FZCO over Cross Border ...).
  const client = clients.sort((a, b) => b.name.length - a.name.length)[0];
  console.log(`  client: ${client.name}`);

  const m = await fetchSpecific(tgt.url);
  if (!m) { console.log("  ⚠️  meeting not found in Fathom for that URL"); continue; }
  const title = m.title || m.meeting_title || `${client.name} — call`;
  const notes = notesFrom(m);
  const when = m.scheduled_start_time || m.meeting_time || m.created_at || null;

  // Insert meeting (idempotent by recording_link).
  const { data: existing } = await db.from("client_meetings").select("id").eq("client_id", client.id).eq("recording_link", tgt.url).maybeSingle();
  if (!existing) {
    const { error } = await db.from("client_meetings").insert({
      org_id: orgId, client_id: client.id, title,
      meeting_date: when ? new Date(when).toISOString().slice(0, 10) : null,
      recording_link: tgt.url, notes: notes || null, source: "fathom", created_by: "manual-backfill",
    });
    console.log(`  meeting inserted: ${error ? "ERR " + error.message : "ok"}`);
  } else {
    console.log("  meeting already present");
  }

  // Trigger insights extraction via the live route — we call the public sync action via API.
  // The sync action will dedupe + re-run extractCallInsights on the latest meeting.
  await db.from("clients").update({ call_link: tgt.url, call_notes: notes }).eq("id", client.id);
  console.log(`  call_link + notes saved (${notes.length} chars)`);
}

console.log("\nDone. Now hit the backfill route to run AI extraction on all newly-saved notes:");
console.log("  curl -sS http://localhost:3000/api/admin/backfill-fathom -H 'Authorization: Bearer ' + $env:CRON_SECRET");
