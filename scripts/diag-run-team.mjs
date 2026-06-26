// Diagnose run_team rows per profile.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: profiles } = await db.from("profiles").select("id,email,team_member_id,role").not("team_member_id", "is", null);

for (const p of profiles ?? []) {
  const { data: rt } = await db.from("run_team").select("run_id,role_in_run").eq("team_member_id", p.team_member_id);
  const { data: amRuns } = await db.from("onboarding_runs").select("id").eq("am_id", p.team_member_id);
  const runIds = [...new Set([...(rt ?? []).map((r) => r.run_id), ...(amRuns ?? []).map((r) => r.id)])];
  if (!runIds.length) {
    console.log(`${p.email} — NO runs (would see empty list)`);
    continue;
  }
  // Get clients for these runs
  const { data: runs } = await db.from("onboarding_runs").select("id,client_id,status").in("id", runIds);
  const clientIds = [...new Set((runs ?? []).map((r) => r.client_id))];
  console.log(`${p.email} — runs=${runIds.length} (run_team=${rt?.length ?? 0} + am=${amRuns?.length ?? 0}), clients=${clientIds.length}`);
}
