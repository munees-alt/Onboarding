// Fuzzy-link unlinked profiles to team_members rows where the email-based
// match failed (typically because the team_members row has no email set).
//
// Strategy: take the local part of the profile's email (e.g.
// "shahil@finanshels.com" → "shahil"), find active team_members whose
// full_name contains that substring, and link only when there's EXACTLY ONE
// match. Also stamps team_members.email with the profile's email so future
// signups link instantly via the existing trigger.
//
// Run: node --env-file=.env.local scripts/backfill-profile-by-name.mjs

import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: profiles } = await db
  .from("profiles")
  .select("id,email,team_member_id,role")
  .is("team_member_id", null);

let linked = 0, ambiguous = 0, none = 0, noEmail = 0;
for (const p of profiles ?? []) {
  if (!p.email) { noEmail++; continue; }

  // Skip if a matching team_members.email already exists (the auth fallback
  // will pick it up on next sign-in).
  const { data: byEmail } = await db
    .from("team_members")
    .select("id,role")
    .ilike("email", p.email)
    .eq("active", true)
    .maybeSingle();
  if (byEmail) {
    await db.from("profiles").update({ team_member_id: byEmail.id, role: byEmail.role ?? p.role ?? "junior" }).eq("id", p.id);
    linked++;
    console.log("linked via email", p.email);
    continue;
  }

  const local = (p.email.split("@")[0] ?? "").trim();
  if (local.length < 3) { none++; continue; }

  const { data: cand } = await db
    .from("team_members")
    .select("id,full_name,role,email")
    .ilike("full_name", `%${local}%`)
    .eq("active", true);
  if (!cand || cand.length === 0) { none++; console.log("no candidate for", p.email); continue; }
  if (cand.length > 1) {
    ambiguous++;
    console.log("AMBIGUOUS for", p.email, "→", cand.map((c) => c.full_name).join(" / "));
    continue;
  }
  const tm = cand[0];
  // Link profile + stamp the email so trigger-based linking works going forward.
  await db.from("profiles").update({ team_member_id: tm.id, role: tm.role ?? p.role ?? "junior" }).eq("id", p.id);
  if (!tm.email) await db.from("team_members").update({ email: p.email }).eq("id", tm.id);
  linked++;
  console.log("linked via name", p.email, "→", tm.full_name, "(", tm.role, ")");
}

console.log(`\nDone. linked=${linked} ambiguous=${ambiguous} no-match=${none} no-email=${noEmail}`);
