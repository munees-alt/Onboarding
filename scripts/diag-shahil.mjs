// Find Shahil in team_members (by name) and check if their email is set or
// they're linked to a profile.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: shahilProfiles } = await db.from("profiles").select("id,email,team_member_id,role").ilike("email", "shahil%");
console.log("Profiles named shahil:");
console.log(shahilProfiles);

const { data: shahilMembers } = await db.from("team_members").select("id,full_name,email,role,active,reports_to,org_id").ilike("full_name", "%shahil%");
console.log("\nTeam members named shahil:");
console.log(shahilMembers);

// Also list anyone with role=senior who has no email set, so we can see how many seniors are unlinked
const { data: seniorNoEmail } = await db.from("team_members").select("id,full_name,role").is("email", null).eq("active", true).eq("role", "senior").order("full_name");
console.log(`\nSenior team members with NO email set: ${seniorNoEmail?.length ?? 0}`);
seniorNoEmail?.slice(0, 30).forEach((s) => console.log(`  ${s.full_name}`));

// Same for team_lead
const { data: tlNoEmail } = await db.from("team_members").select("id,full_name,role").is("email", null).eq("active", true).eq("role", "team_lead").order("full_name");
console.log(`\nTeam Lead team members with NO email set: ${tlNoEmail?.length ?? 0}`);
tlNoEmail?.slice(0, 30).forEach((s) => console.log(`  ${s.full_name}`));

// And juniors
const { data: jrNoEmail } = await db.from("team_members").select("id,full_name,role").is("email", null).eq("active", true).eq("role", "junior").order("full_name");
console.log(`\nJunior team members with NO email set: ${jrNoEmail?.length ?? 0}`);
