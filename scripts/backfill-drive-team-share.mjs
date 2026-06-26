// One-shot: re-share each client Drive folder with every current run_team
// member's email. Brings existing runs into the new "everyone on the team gets
// Drive access" world.
//
// Drive treats already-shared emails as a no-op, so this is safe to re-run.
//
// Run: node --env-file=.env.local scripts/backfill-drive-team-share.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(SUPABASE_URL, SVC, { auth: { persistSession: false } });

// We can't import the Next runtime google.ts helpers (server-only). Call the
// google API directly — same flow as shareDriveFolder + getDriveCapableMemberId.
import crypto from "node:crypto";

const KEY = process.env.CADENCE_ENCRYPTION_KEY || "";
function decrypt(enc) {
  try {
    const buf = Buffer.from(enc, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) { return null; }
}

async function refreshAccessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.access_token ?? null;
}

async function getDriveCapableMemberId(orgId) {
  const { data } = await db
    .from("member_connections")
    .select("team_member_id,config,team_members!inner(org_id,active)")
    .eq("provider", "google")
    .eq("connected", true)
    .eq("team_members.org_id", orgId)
    .eq("team_members.active", true);
  for (const row of data ?? []) {
    const refresh = decrypt(row.config?.refresh_enc);
    if (refresh) return row.team_member_id;
  }
  return null;
}

async function getAccessTokenForMember(memberId) {
  const { data } = await db
    .from("member_connections")
    .select("config")
    .eq("provider", "google")
    .eq("team_member_id", memberId)
    .maybeSingle();
  const refresh = data?.config?.refresh_enc && decrypt(data.config.refresh_enc);
  if (!refresh) return null;
  return await refreshAccessToken(refresh);
}

async function shareWith(token, folderId, email) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }),
  });
  return r.ok || r.status === 409;
}

// Iterate all open runs with a Drive folder.
const { data: runs } = await db
  .from("onboarding_runs")
  .select("id,org_id,client_id,status")
  .not("status", "in", "(archived,closed)");

let touched = 0, skipped = 0, errors = 0;
const tokenCache = new Map();

for (const run of runs ?? []) {
  const { data: df } = await db.from("drive_folders").select("tree").eq("client_id", run.client_id).maybeSingle();
  const folderId = df?.tree?.id;
  if (!folderId) { skipped++; continue; }

  const { data: rt } = await db
    .from("run_team")
    .select("team_members(email,full_name)")
    .eq("run_id", run.id);
  const emails = (rt ?? [])
    .map((r) => (Array.isArray(r.team_members) ? r.team_members[0] : r.team_members)?.email)
    .filter((e) => e && e.includes("@"));
  if (!emails.length) { skipped++; continue; }

  let token = tokenCache.get(run.org_id);
  if (token === undefined) {
    const mid = await getDriveCapableMemberId(run.org_id);
    if (!mid) { tokenCache.set(run.org_id, null); token = null; }
    else {
      const t = await getAccessTokenForMember(mid);
      tokenCache.set(run.org_id, t);
      token = t;
    }
  }
  if (!token) { skipped++; continue; }

  let ok = 0;
  for (const e of emails) {
    const r = await shareWith(token, folderId, e);
    if (r) ok++; else errors++;
  }
  console.log("run", run.id, "→", ok, "/", emails.length, "shared");
  touched++;
}
console.log(`Done. touched=${touched} skipped=${skipped} share-errors=${errors}`);
