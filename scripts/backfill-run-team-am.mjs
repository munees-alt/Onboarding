// Backfill: for every active run, make sure the current AM is in run_team.
// Earlier runs may have been created before clients.am_id was set, or the AM
// changed since creation. Seniors/TLs missing from run_team is a SEPARATE
// issue (they only get added at assign-step time), and is fixed naturally
// once anyone assigns a step in those runs.
//
// Run: node --env-file=.env.local scripts/backfill-run-team-am.mjs

import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: runs } = await db
  .from("onboarding_runs")
  .select("id,am_id,client_id,status")
  .not("status", "in", "(archived,closed)");

let added = 0, already = 0, noAm = 0;
for (const run of runs ?? []) {
  // Prefer the client's CURRENT am_id over the run's stored am_id, since
  // clients.am_id is the source of truth and may have been changed.
  const { data: client } = await db.from("clients").select("am_id").eq("id", run.client_id).maybeSingle();
  const amId = client?.am_id || run.am_id;
  if (!amId) { noAm++; continue; }

  const { data: existing } = await db
    .from("run_team")
    .select("id")
    .eq("run_id", run.id)
    .eq("team_member_id", amId)
    .maybeSingle();
  if (existing) { already++; continue; }

  const { error } = await db.from("run_team").upsert(
    { run_id: run.id, team_member_id: amId, role_in_run: "am" },
    { onConflict: "run_id,team_member_id" },
  );
  if (error) { console.error("insert failed", run.id, error); continue; }
  added++;
}

console.log(`Done. AM added: ${added} · already there: ${already} · no AM: ${noAm}`);
