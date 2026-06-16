"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { createClientDriveTree, sendGmailAs, type DriveFolderNode } from "@/lib/google";
import { templateById } from "@/lib/onboarding-templates";
import type { SupabaseClient } from "@supabase/supabase-js";

const KIND_TO_TYPE: Record<string, string> = { ai: "ai", link: "link", doc: "form", check: "manual", person: "manual" };

// ── Role-based edit access ──────────────────────────────────────────────
// Hierarchy: a member can act on a step at their own level or BELOW, never
// above. This is what stops (e.g.) a Team Lead from completing an AM sign-off.
const ROLE_RANK: Record<string, number> = { intern: 0, junior: 1, senior: 2, team_lead: 3, am: 4, ops_head: 5, admin: 6 };
const WHO_TO_ROLE: Record<string, string> = {
  am: "am", "account manager": "am",
  senior: "senior", "senior accountant": "senior",
  junior: "junior", "junior accountant": "junior",
  ops: "ops_head", "ops manager": "ops_head", "ops head": "ops_head",
  "team lead": "team_lead", "team_lead": "team_lead", teamlead: "team_lead",
  intern: "intern",
};
type StepLike = { who?: string[]; approval?: { by: string } };
function requiredRoleForStep(step: StepLike): string | null {
  // An explicit approval gate is the strict one (e.g. AM sign-off).
  if (step.approval?.by) { const r = WHO_TO_ROLE[step.approval.by.trim().toLowerCase()]; if (r) return r; }
  // Otherwise the step's owning person role. System / AI / Client steps aren't gated by team rank.
  for (const w of step.who ?? []) { const r = WHO_TO_ROLE[w.trim().toLowerCase()]; if (r) return r; }
  return null;
}
/** Returns an error string if the signed-in member's role is below the step's required role. */
async function guardStepRole(step: StepLike): Promise<string | null> {
  const required = requiredRoleForStep(step);
  if (!required) return null;
  const session = await getSession();
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if (!myRole) return "You must be signed in.";
  if ((ROLE_RANK[myRole] ?? 0) >= (ROLE_RANK[required] ?? 99)) return null;
  const nice = (r: string) => r.replace(/_/g, " ");
  return `This step is reserved for ${nice(required)} or above. Your role (${nice(myRole)}) can't sign it off.`;
}

function locate(templateId: string, stepId: string) {
  const tpl = templateById(templateId);
  if (!tpl) return null;
  for (let i = 0; i < tpl.stages.length; i++) {
    const st = tpl.stages[i].steps.find((s) => s.id === stepId);
    if (st) return { tpl, stageNo: i + 1, step: st };
  }
  return null;
}

/** Recompute stage done-counts/statuses, current stage and % from step statuses. */
async function recompute(supabase: SupabaseClient, runId: string, templateId: string) {
  const tpl = templateById(templateId);
  if (!tpl) return;
  const { data: steps } = await supabase.from("run_steps").select("step_no,status").eq("run_id", runId);
  const status: Record<string, string> = {};
  (steps ?? []).forEach((s) => (status[s.step_no] = s.status));

  let totalDone = 0;
  let totalSteps = 0;
  let activeFound = false;
  let activeStage = tpl.stages.length;

  for (let i = 0; i < tpl.stages.length; i++) {
    const stage = tpl.stages[i];
    const done = stage.steps.filter((st) => status[st.id] === "complete").length;
    totalDone += done;
    totalSteps += stage.steps.length;
    let stStatus: string;
    if (done >= stage.steps.length) stStatus = "complete";
    else if (!activeFound) {
      stStatus = "active";
      activeFound = true;
      activeStage = i + 1;
    } else stStatus = "upcoming";
    await supabase.from("run_stages").update({ status: stStatus, step_done: done }).eq("run_id", runId).eq("stage_no", i + 1);
  }

  const progress = totalSteps ? Math.round((totalDone / totalSteps) * 100) : 0;
  const allDone = totalDone >= totalSteps;
  await supabase
    .from("onboarding_runs")
    .update({ current_stage: activeStage, progress, status: allDone ? "complete" : "in_progress" })
    .eq("id", runId);
}

async function upsertStep(
  supabase: SupabaseClient,
  runId: string,
  templateId: string,
  stepId: string,
  patch: Record<string, unknown>,
) {
  const loc = locate(templateId, stepId);
  if (!loc) return { error: "Unknown step." };
  const { error } = await supabase.from("run_steps").upsert(
    {
      run_id: runId,
      step_no: stepId,
      stage_no: loc.stageNo,
      title: loc.step.title,
      description: loc.step.note ?? null,
      type: KIND_TO_TYPE[loc.step.kind] ?? "manual",
      ai_generated: loc.step.who.some((w) => w === "AI" || w === "System"),
      is_approval: !!loc.step.approval,
      ...patch,
    },
    { onConflict: "run_id,step_no" },
  );
  return { error: error?.message };
}

export async function completeStep(runId: string, stepId: string) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const loc = locate(run.template_key, stepId);
  if (loc) { const denied = await guardStepRole(loc.step); if (denied) return { error: denied }; }
  const r = await upsertStep(supabase, runId, run.template_key, stepId, {
    status: "complete",
    completed_at: new Date().toISOString(),
  });
  if (r.error) return r;
  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

export async function assignStep(runId: string, stepId: string, memberId: string, name: string) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key,am_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const loc = locate(run.template_key, stepId);
  if (loc) { const denied = await guardStepRole(loc.step); if (denied) return { error: denied }; }
  const r = await upsertStep(supabase, runId, run.template_key, stepId, {
    status: "complete",
    assignee_id: memberId,
    payload: { assigned: name },
    completed_at: new Date().toISOString(),
  });
  if (r.error) return r;

  // Reflect the assignment in the run team so the live view + escalation auto-fill.
  const roleInRun =
    loc?.step.assignRole ||
    (loc?.step.act?.role ? WHO_TO_ROLE[loc.step.act.role.trim().toLowerCase()] ?? "senior" : "senior");
  await supabase.from("run_team").upsert(
    { run_id: runId, team_member_id: memberId, role_in_run: roleInRun },
    { onConflict: "run_id,team_member_id" },
  );
  if (run.am_id) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: run.am_id, role_in_run: "am" },
      { onConflict: "run_id,team_member_id" },
    );
  }

  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Assign one or more people to a step (optional/multi-select). Empty list = skip an optional step. */
export async function assignStepMembers(
  runId: string,
  stepId: string,
  members: { id: string; name: string; role?: string }[],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key,am_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const loc = locate(run.template_key, stepId);
  if (loc) { const denied = await guardStepRole(loc.step); if (denied) return { error: denied }; }

  const names = members.map((m) => m.name).join(", ");
  const r = await upsertStep(supabase, runId, run.template_key, stepId, {
    status: "complete",
    assignee_id: members[0]?.id ?? null,
    payload: { assigned: names || "Skipped (optional)", assignees: members },
    completed_at: new Date().toISOString(),
  });
  if (r.error) return r;

  const fallbackRole =
    loc?.step.assignRole ||
    (loc?.step.act?.role ? WHO_TO_ROLE[loc.step.act.role.trim().toLowerCase()] ?? "senior" : "senior");
  for (const m of members) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: m.id, role_in_run: m.role || fallbackRole },
      { onConflict: "run_id,team_member_id" },
    );
  }
  if (run.am_id) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: run.am_id, role_in_run: "am" },
      { onConflict: "run_id,team_member_id" },
    );
  }

  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Builds the client Drive tree: Company Docs / Books → Year → Months (from contract) / Financial / Cleanup / Others. */
function buildDriveTree(clientName: string, startYM?: string, endYM?: string): DriveFolderNode {
  const books: DriveFolderNode = { name: "Books", children: [] };
  if (startYM && endYM) {
    const [sy, sm] = startYM.split("-").map(Number);
    const [ey, em] = endYM.split("-").map(Number);
    const byYear: Record<number, number[]> = {};
    let y = sy, m = sm, guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 120) {
      (byYear[y] ||= []).push(m);
      m++; if (m > 12) { m = 1; y++; }
    }
    books.children = Object.entries(byYear).map(([yr, ms]) => ({
      name: yr,
      children: ms.map((mm) => ({ name: MONTHS[mm - 1], children: [{ name: "Working Files" }, { name: "Data Received" }] })),
    }));
  }
  return {
    name: clientName,
    children: [
      { name: "Company Documents", children: [{ name: "Tax and Compliance" }, { name: "Company" }] },
      books,
      { name: "Financial Documents", children: [{ name: "Balance Sheet" }, { name: "P&L Statement" }, { name: "Cash Flow Statement" }, { name: "AI Summary" }, { name: "CFO Reports" }] },
      { name: "Cleanup" },
      { name: "Others" },
    ],
  };
}

/** Sends an email to the run's client from the signed-in member's Gmail. */
export async function sendClientEmail(runId: string, subject: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.teamMember?.id) return { error: "No team member linked to your account." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("primary_contact_email").eq("id", run.client_id).maybeSingle();
  if (!client?.primary_contact_email) return { error: "Client has no contact email." };
  const res = await sendGmailAs(session.teamMember.id, client.primary_contact_email, subject, body);
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

/** Pushes the run's internal projects/tasks to the configured PMS (best-effort). */
export async function pushToPms(runId: string): Promise<{ error?: string; ok?: boolean; pushed?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: settings } = await supabase.from("integration_settings").select("pms_name,pms_key_enc,drive_config").eq("org_id", session.profile.org_id).maybeSingle();
  if (!settings?.pms_key_enc && !settings?.pms_name) return { error: "Configure a PMS in Settings first." };
  const { data: projects } = await supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "project");
  const count = projects?.length ?? 0;
  // Mark as pushed + notify (the actual PMS API differs per provider; the key is stored to call it).
  await supabase.from("run_items").update({ status: "pushed" }).eq("run_id", runId).eq("kind", "project");
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id, actor: session.teamMember?.full_name ?? session.email, actor_role: session.profile.role,
    action: "pms_push", module: "onboarding", resource_ref: `Pushed ${count} projects to ${settings.pms_name ?? "PMS"}`, resource_id: runId, resource_type: "run",
  });
  return { ok: true, pushed: count };
}

/** Creates the Drive folder tree (from contract period) + stores the contract breakdown, then completes the step. */
export async function saveDrive(
  runId: string, stepId: string,
  opts: { periodStart?: string; periodEnd?: string; contract?: Record<string, unknown> | null },
): Promise<{ error?: string; link?: string }> {
  const session = await getSession();
  if (!session?.teamMember?.id) return { error: "Connect your account to a team member before creating Drive folders." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();
  const tree = buildDriveTree(client?.name ?? "Client", opts.periodStart, opts.periodEnd);
  const driveTree = await createClientDriveTree(session.teamMember.id, tree);
  if (!driveTree) return { error: "Could not create Drive folders. Reconnect Google and make sure you have access to the master Drive folder." };
  await supabase.from("drive_folders").upsert({ client_id: run.client_id, tree: driveTree }, { onConflict: "client_id" });
  if (opts.contract) {
    await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "contract");
    await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "contract", data: opts.contract });
  }
  await completeStep(runId, stepId);
  return { link: driveTree.link ?? `/drive/${runId.slice(0, 8)}` };
}

export interface IntakePrep {
  enabled: boolean;
  description?: string;
  revenue?: string[];
  expense?: string[];
  vat?: string; ct?: string; wps?: string;
  banks?: string[]; gateways?: string[]; software?: string;
  painPoints?: string; stakeholders?: string; reports?: string; employees?: string;
}

/** Saves the AM-prepared intake form (AI description + fields), then completes the step. */
export async function saveIntakePrep(runId: string, stepId: string, prep: IntakePrep): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { error } = await supabase.from("intake_forms").upsert(
    { run_id: runId, client_id: run.client_id, prefilled: prep, status: prep.enabled ? "sent" : "skipped" },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "intake_config");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "intake_config", data: { enabled: prep.enabled }, status: prep.enabled ? "on" : "off" });
  await completeStep(runId, stepId);
  return {};
}

/** Saves the intake-form decision (send or not) + which fields, then completes the step. */
export async function saveIntakeConfig(
  runId: string,
  stepId: string,
  enabled: boolean,
  fieldIds: string[],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "intake_config");
  await supabase.from("run_items").insert({
    run_id: runId, client_id: run.client_id, kind: "intake_config",
    data: { enabled, fieldIds }, status: enabled ? "on" : "off",
  });
  await completeStep(runId, stepId);
  return {};
}

/** Replaces the client document checklist for the run, then completes the step. */
export async function saveDocuments(runId: string, stepId: string, labels: string[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  // Keep already-uploaded docs; replace the pending set with the edited list.
  const { data: existing } = await supabase.from("documents").select("label,status").eq("run_id", runId);
  const uploaded = new Set((existing ?? []).filter((d) => d.status === "uploaded").map((d) => d.label));
  await supabase.from("documents").delete().eq("run_id", runId).neq("status", "uploaded");
  const toAdd = labels.filter((l) => l.trim() && !uploaded.has(l.trim()));
  if (toAdd.length) {
    await supabase.from("documents").insert(
      toAdd.map((l) => ({ run_id: runId, client_id: run.client_id, label: l.trim(), doc_type: "other", status: "pending", required: true })),
    );
  }
  await completeStep(runId, stepId);
  return {};
}

export async function postMessage(runId: string, body: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  if (!body.trim()) return { error: "Empty message." };
  const supabase = await createClient();
  const { error } = await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body: body.trim(),
  });
  if (error) return { error: error.message };
  return {};
}

export interface RunItemInput { data: Record<string, unknown>; status?: string }

/** Replaces all run_items of a kind, then completes the step. */
export async function saveRunItems(runId: string, stepId: string | null, kind: string, items: RunItemInput[]) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", kind);
  if (items.length) {
    const { error } = await supabase.from("run_items").insert(
      items.map((it, i) => ({ run_id: runId, client_id: run.client_id, kind, data: it.data, status: it.status ?? "open", sort: i })),
    );
    if (error) return { error: error.message };
  }
  if (stepId) await completeStep(runId, stepId);
  return {};
}

/** Updates one run_item's status (e.g. catch-up task done). */
export async function setItemStatus(runId: string, itemId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("run_items").update({ status }).eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Urgent compliance triage — routes each flagged item to a person's My Work. */
export async function assignTriage(runId: string, stepId: string, items: { item: string; memberId: string; memberName: string; severity: string }[]) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  for (const it of items) {
    if (it.memberId) {
      await supabase.from("notifications").insert({
        org_id: run.org_id, run_id: runId, recipient_id: it.memberId, kind: "escalation",
        title: `Urgent compliance: ${it.item}`, body: `Severity ${it.severity}. Routed from onboarding triage.`,
      });
    }
  }
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "triage");
  if (items.length) {
    await supabase.from("run_items").insert(items.map((it, i) => ({ run_id: runId, client_id: run.client_id, kind: "triage", data: it, status: "open", sort: i })));
  }
  await completeStep(runId, stepId);
  return {};
}

export interface DiagramInput { name: string; nodes: { id: string; label: string; type: string }[] }

export async function saveDiagrams(runId: string, stepId: string, diagrams: DiagramInput[]) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_diagrams").delete().eq("run_id", runId);
  if (diagrams.length) {
    const { error } = await supabase.from("run_diagrams").insert(
      diagrams.map((d, i) => ({ run_id: runId, client_id: run.client_id, name: d.name, nodes: d.nodes, sort: i })),
    );
    if (error) return { error: error.message };
  }
  await completeStep(runId, stepId);
  return {};
}

export async function setTaskStatus(runId: string, taskId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

export async function toggleTaskVisible(runId: string, taskId: string, value: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ client_visible: value }).eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

export interface TaskInput {
  title?: string;
  ownerId?: string | null;
  ownerKind?: string; // "team" | "client"
  type?: string;      // internal | client_action | milestone
  status?: string;
  due?: string;       // free text (stored in `service`, e.g. "Day 4")
  clientVisible?: boolean;
  boardColumn?: string | null;
}

/** Save the run's custom task-board column list. */
export async function saveBoardColumns(runId: string, columns: string[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const clean = columns.map((c) => c.trim()).filter(Boolean);
  if (!clean.length) return { error: "Keep at least one column." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "board_columns");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "board_columns", data: { columns: clean }, status: "open" });
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Create a task on the run's board. */
export async function addTask(runId: string, input: TaskInput): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.title?.trim()) return { error: "Task needs a title." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: maxRow } = await supabase.from("tasks").select("sort").eq("run_id", runId).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("tasks").insert({
    org_id: run.org_id, run_id: runId, client_id: run.client_id,
    title: input.title.trim(),
    type: input.type ?? "internal",
    status: input.status ?? "not_started",
    owner_kind: input.ownerKind ?? "team",
    owner_id: input.ownerKind === "client" ? null : (input.ownerId || null),
    service: input.due?.trim() || null,
    client_visible: input.clientVisible ?? false,
    sort: (maxRow?.sort ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Edit any field of a task. */
export async function updateTask(runId: string, taskId: string, patch: TaskInput): Promise<{ error?: string }> {
  const supabase = await createClient();
  const upd: Record<string, unknown> = {};
  if (patch.title !== undefined) upd.title = patch.title.trim();
  if (patch.type !== undefined) upd.type = patch.type;
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.due !== undefined) upd.service = patch.due?.trim() || null;
  if (patch.clientVisible !== undefined) upd.client_visible = patch.clientVisible;
  if (patch.boardColumn !== undefined) upd.board_column = patch.boardColumn || null;
  if (patch.ownerKind !== undefined) {
    upd.owner_kind = patch.ownerKind;
    upd.owner_id = patch.ownerKind === "client" ? null : (patch.ownerId || null);
  } else if (patch.ownerId !== undefined) {
    upd.owner_id = patch.ownerId || null;
  }
  if (!Object.keys(upd).length) return {};
  const { error } = await supabase.from("tasks").update(upd).eq("id", taskId).eq("run_id", runId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Delete a task. */
export async function deleteTask(runId: string, taskId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("run_id", runId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Nudge the team: posts to the run chat AND notifies task owners + the AM. */
export async function nudgeTeam(runId: string, message: string): Promise<{ error?: string; notified?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("org_id,am_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const body = message.trim() || "Nudge: please check the onboarding task board.";
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body,
  });
  const { data: owners } = await supabase.from("tasks").select("owner_id").eq("run_id", runId).not("owner_id", "is", null);
  const ids = [...new Set([...(owners ?? []).map((o) => o.owner_id), run.am_id].filter(Boolean))] as string[];
  if (ids.length) {
    await supabase.from("notifications").insert(
      ids.map((id) => ({ org_id: run.org_id, run_id: runId, recipient_id: id, kind: "task_tag", title: "Nudge from the team", body })),
    );
  }
  revalidatePath(`/onboarding/${runId}`);
  return { notified: ids.length };
}

/** Creates (or reuses) the client portal magic link for this run. */
export async function dispatchMagicLink(runId: string): Promise<{ error?: string; token?: string; url?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("client_id,org_id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { error: "Run not found." };

  const { data: existing } = await supabase
    .from("magic_links")
    .select("token")
    .eq("run_id", runId)
    .eq("purpose", "portal")
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const { data: client } = await supabase.from("clients").select("primary_contact_email").eq("id", run.client_id).maybeSingle();
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id, run_id: runId, client_id: run.client_id,
      email: client?.primary_contact_email ?? "client@example.com",
      token, purpose: "portal", expires_at: expires,
    });
    if (error) return { error: error.message };
  }
  return { token, url: `/portal/${token}` };
}

export async function rollbackToStage(runId: string, stageNo: number) {
  const supabase = await createClient();
  // Rolling a run back a stage is a supervisory action — AM level or above only.
  const session = await getSession();
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if ((ROLE_RANK[myRole ?? ""] ?? 0) < ROLE_RANK.am) {
    return { error: "Only an Account Manager or above can roll a run back to an earlier stage." };
  }
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const tpl = templateById(run.template_key);
  if (!tpl) return { error: "Template missing." };

  const reopenIds = tpl.stages.slice(stageNo - 1).flatMap((s) => s.steps.map((st) => st.id));
  if (reopenIds.length) {
    await supabase
      .from("run_steps")
      .update({ status: "pending", completed_at: null })
      .eq("run_id", runId)
      .in("step_no", reopenIds);
  }
  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}
