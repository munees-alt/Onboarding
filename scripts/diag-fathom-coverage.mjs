// Diagnose: for every client without business_description, show why no
// Fathom meeting matched (no name overlap with any title + no attendee email
// on the client's domain). Lists all Fathom meeting titles and attendees so
// you can eyeball any obvious gap.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function decrypt(payload) {
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const [ivb, tagb, encb] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivb, "base64"));
  d.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([d.update(Buffer.from(encb, "base64")), d.final()]).toString("utf8");
}

const { data: org } = await db.from("orgs").select("id").limit(1).single();
const { data: f } = await db.from("member_connections").select("config").eq("provider", "fathom").eq("connected", true).eq("org_id", org.id).limit(1).maybeSingle();
const apiKey = decrypt(f.config.key_enc);

const res = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=false", { headers: { "X-Api-Key": apiKey } });
const j = await res.json();
const items = j.items || j.meetings || [];
console.log(`Fathom returned ${items.length} meetings.\n`);

console.log("=== ALL FATHOM MEETING TITLES ===");
items.forEach((m, i) => {
  const title = (m.title || m.meeting_title || "").slice(0, 80);
  const attendees = (m.invitees || m.participants || m.attendees || []).map(p => p?.email).filter(Boolean);
  console.log(`${String(i+1).padStart(2)}. ${title}`);
  if (attendees.length) console.log(`    attendees: ${attendees.join(", ")}`);
});

const { data: clients } = await db.from("clients").select("id,name,primary_contact_email,business_description").eq("org_id", org.id);
const GENERIC = new Set(["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","live.com","me.com","aol.com"]);

const cleanName = (raw) => raw.toLowerCase().replace(/\b(fze|fzco|fz|llc|l\.l\.c|ltd|inc)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

console.log("\n=== UNMATCHED CLIENTS (with new matcher) ===");
for (const c of clients) {
  if (c.business_description) continue;
  const cleaned = cleanName(c.name || "");
  const tokens = cleaned.split(/\s+/).filter(w => w.length >= 3);
  const email = (c.primary_contact_email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  const dUsable = !!domain && !GENERIC.has(domain);
  const titleMatches = items.filter(m => {
    const t = cleanName(m.title || m.meeting_title || "");
    return tokens.length && tokens.every(tk => t.includes(tk));
  });
  const emailHits = !dUsable ? 0 : items.filter(m => (m.invitees || m.participants || m.attendees || []).some(p => (p?.email || "").toLowerCase().endsWith("@" + domain))).length;
  const totalMatches = titleMatches.length + emailHits;
  console.log(`${totalMatches ? "✓" : "✗"} ${c.name.padEnd(42)} | tokens:[${tokens.join(",")}] titleHits:${titleMatches.length} emailHits:${emailHits}`);
  if (titleMatches.length) titleMatches.forEach(m => console.log(`     → "${(m.title||m.meeting_title||"").slice(0,70)}"`));
}

console.log("\n=== KEYS ON FIRST FATHOM ITEM (to see if attendee field is named differently) ===");
if (items[0]) console.log(Object.keys(items[0]).join(", "));
