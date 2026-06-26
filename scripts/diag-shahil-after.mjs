import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: p } = await db.from("profiles").select("id,email,team_member_id,role").eq("email", "shahil@finanshels.com").maybeSingle();
console.log("Profile:", p);

if (p?.team_member_id) {
  const { data: rt } = await db.from("run_team").select("run_id,role_in_run").eq("team_member_id", p.team_member_id);
  const { data: amRuns } = await db.from("onboarding_runs").select("id").eq("am_id", p.team_member_id);
  console.log(`run_team rows: ${rt?.length ?? 0}`);
  console.log(`am_id runs: ${amRuns?.length ?? 0}`);
  if (rt?.length) {
    const ids = rt.map((r) => r.run_id);
    const { data: runs } = await db.from("onboarding_runs").select("id,client_id,clients(name),status").in("id", ids);
    for (const r of runs ?? []) {
      const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
      console.log(`  · ${c?.name ?? "(no client)"} · ${r.status}`);
    }
  } else {
    console.log("\nSHAHIL HAS NO RUN_TEAM ROWS — the AM has not yet assigned him to any run.");
  }
}
