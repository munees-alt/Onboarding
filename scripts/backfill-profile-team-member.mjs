// One-shot: link profiles to team_members by email where the trigger missed
// it (signup happened BEFORE the team_members row was created, or the email
// was edited later). Also inherits the team member's role into the profile.
//
// Run: node --env-file=.env.local scripts/backfill-profile-team-member.mjs

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: profiles, error } = await db
  .from("profiles")
  .select("id,email,team_member_id,role")
  .is("team_member_id", null);
if (error) { console.error(error); process.exit(1); }

let linked = 0, missing = 0;
for (const p of profiles ?? []) {
  if (!p.email) { missing++; continue; }
  const { data: tm } = await db
    .from("team_members")
    .select("id,role")
    .ilike("email", p.email)
    .eq("active", true)
    .maybeSingle();
  if (!tm) { missing++; continue; }
  const { error: uerr } = await db
    .from("profiles")
    .update({ team_member_id: tm.id, role: tm.role ?? p.role ?? "junior" })
    .eq("id", p.id);
  if (uerr) { console.error("update failed", p.email, uerr); continue; }
  linked++;
  console.log("linked", p.email, "→", tm.id, tm.role);
}
console.log(`Done. Linked ${linked} profile(s). ${missing} had no matching team_members row.`);
