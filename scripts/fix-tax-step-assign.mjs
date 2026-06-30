/**
 * One-shot: find all active Taxation-template runs whose first step has no
 * assignee, then auto-assign Nafila (team lead) + least-loaded member.
 * Run: node --env-file=.env.local scripts/fix-tax-step-assign.mjs
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ── helpers ────────────────────────────────────────────────────────────────

async function findByNameOrTitle(orgId, namePattern, titlePattern) {
  const { data } = await supabase
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .or(`full_name.ilike.${namePattern},title.ilike.${titlePattern}`)
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, name: data.full_name } : null;
}

async function findNafila(orgId) {
  return findByNameOrTitle(orgId, "%nafila%", "%tax%manager%");
}

async function findLeastLoadedMember(orgId, excludeIds) {
  const { data: members } = await supabase
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .not("id", "in", `(${excludeIds.join(",")})`)
    .ilike("dept", "tax");

  if (!members?.length) return null;

  const { data: openRuns } = await supabase
    .from("onboarding_runs")
    .select("am_id")
    .in("am_id", members.map((m) => m.id))
    .not("status", "in", "(archived,closed,complete)");

  const load = {};
  for (const r of openRuns ?? []) load[r.am_id] = (load[r.am_id] ?? 0) + 1;

  const sorted = [...members].sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0));
  return sorted[0] ? { id: sorted[0].id, name: sorted[0].full_name } : null;
}

// ── main ───────────────────────────────────────────────────────────────────

const TAXATION_TEMPLATES = ["ct-registration", "vat-registration", "ct-filing", "vat-filing"];

const { data: runs } = await supabase
  .from("onboarding_runs")
  .select("id,org_id,template_key")
  .in("template_key", TAXATION_TEMPLATES)
  .not("status", "in", "(archived,closed,complete)");

console.log(`Found ${runs?.length ?? 0} active taxation runs`);
if (!runs?.length) process.exit(0);

for (const run of runs) {
  const firstStepId = `${run.template_key}1.1`;

  const { data: step } = await supabase
    .from("run_steps")
    .select("id,assignee_id,step_no")
    .eq("run_id", run.id)
    .eq("step_no", firstStepId)
    .maybeSingle();

  if (!step) {
    console.log(`  [${run.id}] step ${firstStepId} not found — skipping`);
    continue;
  }

  const lead = await findNafila(run.org_id);
  const excludeIds = lead ? [lead.id] : [];
  const member = await findLeastLoadedMember(run.org_id, excludeIds);

  const assignees = [];
  if (lead) assignees.push({ id: lead.id, name: lead.name, role: "team_lead" });
  if (member) assignees.push({ id: member.id, name: member.name, role: "senior" });

  if (!assignees.length) {
    console.log(`  [${run.id}] no tax team members found — skipping`);
    continue;
  }

  const names = assignees.map((a) => a.name).join(", ");
  await supabase
    .from("run_steps")
    .update({ assignee_id: lead?.id ?? member?.id, payload: { assigned: names, assignees } })
    .eq("run_id", run.id)
    .eq("step_no", firstStepId);

  for (const a of assignees) {
    await supabase.from("run_team").upsert(
      { run_id: run.id, team_member_id: a.id, role_in_run: a.role },
      { onConflict: "run_id,team_member_id" },
    );
  }

  console.log(`  [${run.id}] ${run.template_key} → assigned: ${names}`);
}

console.log("Done.");
