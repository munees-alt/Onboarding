// Backfill: rebuild run_team from completed Assign-Team steps. Any TL/Senior/
// Junior who was assigned via the step but is missing from run_team gets added
// (idempotent — onConflict skips duplicates). Fixes the "Senior/TL can't see
// the client" reports caused by run_team upserts not firing on historical
// assigns.
//
// Run: node --env-file=.env.local scripts/backfill-run-team-from-steps.mjs

import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: runs } = await db
  .from("onboarding_runs")
  .select("id,template_key,status")
  .not("status", "in", "(archived,closed)");

let added = 0, runsScanned = 0;
const memberCache = new Map();

async function memberRole(id) {
  if (memberCache.has(id)) return memberCache.get(id);
  const { data } = await db.from("team_members").select("role").eq("id", id).maybeSingle();
  const role = data?.role ?? "senior";
  memberCache.set(id, role);
  return role;
}

for (const run of runs ?? []) {
  runsScanned++;
  // Pull every run_step row + payload for this run; we only care about ones whose
  // payload has an `assignees` array (the format assignStepMembers writes).
  const { data: steps } = await db
    .from("run_steps")
    .select("payload,status,assignee_id")
    .eq("run_id", run.id);
  const assigneeIds = new Set();
  for (const s of steps ?? []) {
    const p = s.payload ?? {};
    if (Array.isArray(p.assignees)) {
      for (const a of p.assignees) {
        if (a?.id) assigneeIds.add(a.id);
      }
    }
    if (s.assignee_id) assigneeIds.add(s.assignee_id);
  }
  if (!assigneeIds.size) continue;

  // Skip anyone already in run_team for this run.
  const { data: existing } = await db.from("run_team").select("team_member_id").eq("run_id", run.id);
  const have = new Set((existing ?? []).map((r) => r.team_member_id));

  for (const id of assigneeIds) {
    if (have.has(id)) continue;
    const role = await memberRole(id);
    const { error } = await db.from("run_team").upsert(
      { run_id: run.id, team_member_id: id, role_in_run: role },
      { onConflict: "run_id,team_member_id" },
    );
    if (!error) added++;
    else console.error("insert failed", run.id, id, error);
  }
}
console.log(`Scanned ${runsScanned} runs. Added ${added} run_team rows.`);
