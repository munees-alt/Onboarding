// Diagnose profile→team_member linking state.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: profiles } = await db.from("profiles").select("id,email,team_member_id,role");
const linked = profiles.filter((p) => p.team_member_id).length;
const unlinked = profiles.filter((p) => !p.team_member_id);
console.log(`Total profiles: ${profiles.length}, linked: ${linked}, unlinked: ${unlinked.length}`);
console.log("\nUnlinked profiles:");
unlinked.forEach((p) => console.log(`  ${p.email} · role=${p.role}`));

console.log("\nLinked profiles (sample):");
const linkedSample = profiles.filter((p) => p.team_member_id).slice(0, 10);
for (const p of linkedSample) {
  const { data: tm } = await db.from("team_members").select("full_name,role,email,active").eq("id", p.team_member_id).maybeSingle();
  console.log(`  ${p.email} · profile.role=${p.role} · tm=${tm?.full_name} · tm.role=${tm?.role} · tm.email=${tm?.email} · active=${tm?.active}`);
}

console.log("\nTeam members WITHOUT email (can never link):");
const { data: noEmail } = await db.from("team_members").select("id,full_name,role,active").is("email", null).eq("active", true).order("full_name");
console.log(`  ${noEmail?.length ?? 0} active team members have NO email set`);
if (noEmail?.length) noEmail.slice(0, 20).forEach((t) => console.log(`    ${t.full_name} · ${t.role}`));
