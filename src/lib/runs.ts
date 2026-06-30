import type { SupabaseClient } from "@supabase/supabase-js";
import { ONB_TEMPLATES, type OnbTemplate } from "./onboarding-templates";
import { getTemplate } from "./templates-store";
import { findTaxTeamLead, findTaxHead, suggestNextAm } from "./capacity";

export interface CreateRunOpts {
  orgId: string;
  clientId: string;
  amId: string | null;
  templateId?: string;
  startedAt?: string; // YYYY-MM-DD
  targetCompletion?: string | null;
}

const KIND_TO_TYPE: Record<string, string> = {
  ai: "ai",
  link: "link",
  doc: "form",
  check: "manual",
  person: "manual",
};

/**
 * Creates an onboarding run from the chosen template (default Medium Team):
 * the run row, its stages, and every step (status pending; stage 1 active).
 * Per-run dynamic state (status/assignee/AI output) lives on run_steps; the
 * static structure (titles, tags, gates, actions) is read from the template.
 */
export async function createRunFromTemplate(
  supabase: SupabaseClient,
  opts: CreateRunOpts,
): Promise<string> {
  const tpl: OnbTemplate =
    (await getTemplate(opts.templateId ?? "medium-team")) ?? ONB_TEMPLATES[1];
  const today = opts.startedAt ?? new Date().toISOString().slice(0, 10);

  const { data: run, error } = await supabase
    .from("onboarding_runs")
    .insert({
      org_id: opts.orgId,
      client_id: opts.clientId,
      am_id: opts.amId,
      status: "active",
      template_key: tpl.id,
      started_at: today,
      target_completion: opts.targetCompletion ?? null,
      current_stage: 1,
      progress: 0,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Failed to create run");
  const runId = run.id as string;

  // Seed the run team with the AM so the live view + escalation have a contact from day one.
  if (opts.amId) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: opts.amId, role_in_run: "am" },
      { onConflict: "run_id,team_member_id" },
    );
  }

  // The Onboarding Partner is Munees by default for every client. Seed it so the
  // portal/playbook can show it alongside the (client-selected) Account Manager.
  const { data: partner } = await supabase
    .from("team_members")
    .select("id")
    .eq("org_id", opts.orgId)
    .ilike("full_name", "munees%")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (partner?.id && partner.id !== opts.amId) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: partner.id, role_in_run: "onboarding_partner" },
      { onConflict: "run_id,team_member_id" },
    );
  }

  const stages = tpl.stages.map((s, i) => ({
    run_id: runId,
    stage_no: i + 1,
    name: s.name,
    status: i === 0 ? "active" : "upcoming",
    step_total: s.steps.length,
    step_done: s.steps.filter((st) => st.pre).length, // auto/System steps start done
    sort: i + 1,
  }));
  const { error: se } = await supabase.from("run_stages").insert(stages);
  if (se) throw new Error(se.message);

  const steps = tpl.stages.flatMap((s, si) =>
    s.steps.map((st, idx) => {
      const isAuto = st.who.some((w) => w === "System" || w === "AI");
      const isApproval = !!st.approval || s.gate?.after === st.id;
      return {
        run_id: runId,
        stage_no: si + 1,
        step_no: st.id,
        title: st.title,
        description: st.note ?? null,
        type: KIND_TO_TYPE[st.kind] ?? "manual",
        // Auto/System "pre" steps (e.g. "Run auto-created") are done from the start —
        // the first thing a human does is the assignment, not a Mark-done.
        status: st.pre ? "complete" : "pending",
        completed_at: st.pre ? new Date().toISOString() : null,
        assignee_id: null,
        ai_generated: isAuto,
        is_approval: isApproval,
        payload: {},
        sort: si * 100 + idx,
      };
    }),
  );
  const { error: te } = await supabase.from("run_steps").insert(steps);
  if (te) throw new Error(te.message);

  // Pre-load the template's document checklist so the onboarding portal has it.
  if (tpl.uploads?.length) {
    await supabase.from("documents").insert(
      tpl.uploads.map((u) => ({
        run_id: runId,
        client_id: opts.clientId,
        label: u.label,
        doc_type: "other",
        status: "pending",
        required: !u.suggested,
      })),
    );
  }

  // Pre-load the template's task board.
  if (tpl.taskboard?.length) {
    await supabase.from("tasks").insert(
      tpl.taskboard.map((t, i) => {
        const isClient = t.owner === "Client";
        const type = isClient ? "client_action" : t.clientVisible ? "milestone" : "internal";
        return {
          org_id: opts.orgId,
          run_id: runId,
          client_id: opts.clientId,
          title: t.title,
          type,
          status: "not_started",
          owner_kind: isClient ? "client" : "team",
          owner_id: t.owner === "AM" ? opts.amId : null,
          client_visible: t.clientVisible,
          service: t.due,
          sort: i,
        };
      }),
    );
  }

  // For Taxation-category templates, pre-populate the Assign Team steps with defaults:
  //   Step 0.1 (AM)          → Tax Head (Gautam)
  //   Step 0.2 (Team Lead)   → Nafila
  //   Step 0.3 (Team Member) → least-loaded member under Nafila by capacity
  if (tpl.category === "Taxation") {
    try {
      const head = await findTaxHead(opts.orgId);
      const lead = await findTaxTeamLead(opts.orgId, head?.id);
      const member = await suggestNextAm(opts.orgId);
      const idp = tpl.id;
      const defaults: { stepNo: string; id: string; name: string; role: string }[] = [];
      if (head) defaults.push({ stepNo: `${idp}0.1`, id: head.id, name: head.name, role: "am" });
      if (lead) defaults.push({ stepNo: `${idp}0.2`, id: lead.id, name: lead.name, role: "team_lead" });
      if (member) defaults.push({ stepNo: `${idp}0.3`, id: member.id, name: member.name, role: "senior" });
      for (const d of defaults) {
        await supabase.from("run_steps")
          .update({ assignee_id: d.id, payload: { assigned: d.name, assignees: [{ id: d.id, name: d.name, role: d.role }] } })
          .eq("run_id", runId)
          .eq("step_no", d.stepNo);
        await supabase.from("run_team").upsert(
          { run_id: runId, team_member_id: d.id, role_in_run: d.role },
          { onConflict: "run_id,team_member_id" },
        );
      }
    } catch {
      // Non-fatal — defaults can be set manually in the Assign Team stage.
    }
  }

  return runId;
}
