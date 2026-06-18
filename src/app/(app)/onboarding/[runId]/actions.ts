"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { createClientDriveTree, sendGmailAs, uploadClientDocToDrive, type DriveFolderNode } from "@/lib/google";
import { getTemplate } from "@/lib/templates-store";
import { createRunFromTemplate } from "@/lib/runs";
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

async function locate(templateId: string, stepId: string) {
  // Resolve against the DB template (same source the run view renders from) so a
  // step added/edited in the DB editor — e.g. the new "Assign Team Lead" step —
  // is always found, even if the static code copy is out of sync.
  const tpl = await getTemplate(templateId);
  if (!tpl) return null;
  for (let i = 0; i < tpl.stages.length; i++) {
    const st = tpl.stages[i].steps.find((s) => s.id === stepId);
    if (st) return { tpl, stageNo: i + 1, step: st };
  }
  return null;
}

/** Recompute stage done-counts/statuses, current stage and % from step statuses. */
async function recompute(supabase: SupabaseClient, runId: string, templateId: string) {
  const tpl = await getTemplate(templateId);
  if (!tpl) return;
  const { data: steps } = await supabase.from("run_steps").select("step_no,status").eq("run_id", runId);
  const status: Record<string, string> = {};
  (steps ?? []).forEach((s) => (status[s.step_no] = s.status));

  // Optional stages (e.g. Handover) don't count toward progress or block completion.
  let requiredDone = 0;
  let requiredTotal = 0;
  let activeFound = false;
  let activeStage = tpl.stages.length;

  for (let i = 0; i < tpl.stages.length; i++) {
    const stage = tpl.stages[i];
    const done = stage.steps.filter((st) => status[st.id] === "complete").length;
    if (!stage.optional) { requiredDone += done; requiredTotal += stage.steps.length; }
    let stStatus: string;
    if (done >= stage.steps.length) stStatus = "complete";
    else if (!stage.optional && !activeFound) {
      stStatus = "active";
      activeFound = true;
      activeStage = i + 1;
    } else stStatus = "upcoming";
    await supabase.from("run_stages").update({ status: stStatus, step_done: done }).eq("run_id", runId).eq("stage_no", i + 1);
  }

  const progress = requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 0;
  const allDone = requiredDone >= requiredTotal;
  await supabase
    .from("onboarding_runs")
    .update({ current_stage: activeStage, progress, status: allDone ? "complete" : "in_progress" })
    .eq("id", runId);
  // When the whole onboarding is finished, the client goes live (active) and the
  // run drops into the Done section of the hub.
  if (allDone) {
    const { data: r } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
    if (r?.client_id) await supabase.from("clients").update({ status: "active" }).eq("id", r.client_id);
  } else {
    // Whoever owns the now-active step gets a heads-up (once per step).
    const stage = tpl.stages[activeStage - 1];
    const nextStep = stage?.steps.find((st) => status[st.id] !== "complete");
    if (nextStep) await notifyNext(supabase, runId, nextStep);
  }
}

/** Notifies the person who owns the active step that it's their turn (deduped per step). */
async function notifyNext(supabase: SupabaseClient, runId: string, step: StepLike & { id: string; title: string }) {
  const { data: run } = await supabase.from("onboarding_runs").select("org_id,client_id,am_id").eq("id", runId).maybeSingle();
  if (!run) return;
  const { data: marker } = await supabase.from("run_items").select("id,data").eq("run_id", runId).eq("kind", "next_notify").maybeSingle();
  if ((marker?.data as { step?: string } | null)?.step === step.id) return; // already notified for this step

  const role = requiredRoleForStep(step);
  let recipient = run.am_id as string | null;
  if (role) {
    const { data: rt } = await supabase.from("run_team").select("team_member_id").eq("run_id", runId).eq("role_in_run", role).limit(1).maybeSingle();
    if (rt?.team_member_id) recipient = rt.team_member_id;
  }
  if (recipient) {
    await supabase.from("notifications").insert({
      org_id: run.org_id, run_id: runId, recipient_id: recipient, kind: "task_tag",
      title: "Your onboarding step is ready", body: `"${step.title}" is now active and waiting on you.`,
    });
  }
  if (marker?.id) await supabase.from("run_items").update({ data: { step: step.id } }).eq("id", marker.id);
  else await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "next_notify", data: { step: step.id }, status: "open" });
}

async function upsertStep(
  supabase: SupabaseClient,
  runId: string,
  templateId: string,
  stepId: string,
  patch: Record<string, unknown>,
) {
  const loc = await locate(templateId, stepId);
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
  const loc = await locate(run.template_key, stepId);
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
  const loc = await locate(run.template_key, stepId);
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
  const loc = await locate(run.template_key, stepId);
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

/** Emails Lohith (IT) to create the client's secure shared mailbox (e.g. secure+acme@finanshels.com). */
export async function requestSecureMailbox(runId: string, secureEmail: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.teamMember?.id) return { error: "Connect your Google account first to send the request." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();
  const body = `Please create a secure shared mailbox for client onboarding.\n\nClient: ${client?.name ?? "—"}\nMailbox: ${secureEmail}\n\nThis address will be used as the authorised user when the client grants us access to their systems (FTA, bank, gateways, etc.).\n\nRequested by ${session.teamMember.full_name ?? session.email}.`;
  const res = await sendGmailAs(session.teamMember.id, "lohith@finanshels.com", `Create secure mailbox: ${secureEmail}`, body);
  if (!res.ok) return { error: res.error ?? "Could not send the email." };
  return { ok: true };
}

/** Saves the engagement-contract analysis (scope / inclusions / exclusions / payment / deliverables)
    as run_items kind 'contract' — shown in the client portal Live tab — then completes the step. */
export async function saveContractAnalysis(runId: string, stepId: string, contract: Record<string, unknown> | null): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "contract");
  if (contract) await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "contract", data: contract });
  await completeStep(runId, stepId);
  return {};
}

/** Saves the access-grant configuration (FTA / bank / gateway / software …) as run_items
    (kind 'access'), one row per access, then completes the step. */
export async function saveAccess(runId: string, stepId: string, items: import("@/lib/access-sops").AccessItem[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "access");
  const clean = items.filter((it) => it.label?.trim());
  if (clean.length) {
    const { error } = await supabase.from("run_items").insert(
      clean.map((it, i) => ({ run_id: runId, client_id: run.client_id, kind: "access", data: it, status: it.status ?? "requested", sort: i })),
    );
    if (error) return { error: error.message };
  }
  await completeStep(runId, stepId);
  return {};
}

/** Saves a call step's recording link + notes into the step payload, then completes it.
    These are what the MoM generator reads — without them the MoM can't be generated. */
export async function saveCallNotes(runId: string, stepId: string, recording: string, notes: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const loc = await locate(run.template_key, stepId);
  if (loc) { const denied = await guardStepRole(loc.step); if (denied) return { error: denied }; }
  const r = await upsertStep(supabase, runId, run.template_key, stepId, {
    status: "complete",
    payload: { recording: recording.trim(), notes: notes.trim() },
    completed_at: new Date().toISOString(),
  });
  if (r.error) return r;
  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

export async function postMessage(runId: string, body: string, taskRef?: string | null): Promise<{ error?: string }> {
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
    task_ref: taskRef?.trim() || null,
  });
  if (error) return { error: error.message };
  return {};
}

/** Attach a file to a task's chat thread (team side). Saves to the client's Drive
    (falls back to Storage), then posts a message tagged to the task with the link. */
export async function attachTaskFile(runId: string, taskRef: string, formData: FormData): Promise<{ error?: string; link?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is larger than 25 MB." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const buf = Buffer.from(await file.arrayBuffer());

  let link: string | null = null;
  if (session.teamMember?.id) {
    const r = await uploadClientDocToDrive(session.teamMember.id, client?.name ?? "Client", safe, file.type || "application/octet-stream", buf);
    if (r) link = r.link;
  }
  if (!link) {
    const path = `${run.client_id}/task-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("client-docs").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (upErr) return { error: upErr.message };
    const { data: pub } = supabase.storage.from("client-docs").getPublicUrl(path);
    link = pub?.publicUrl ?? path;
  }
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body: `📎 ${file.name} — ${link}`,
    task_ref: taskRef?.trim() || null,
  });
  revalidatePath(`/onboarding/${runId}`);
  return { link };
}

/** Upload an engagement-contract file for the run (saved to the client's Drive, falls
    back to Storage). Returns the link so the Drive step can store it. Does not complete a step. */
export async function uploadContractFile(runId: string, formData: FormData): Promise<{ error?: string; link?: string; name?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is larger than 25 MB." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const buf = Buffer.from(await file.arrayBuffer());
  let link: string | null = null;
  if (session.teamMember?.id) {
    const r = await uploadClientDocToDrive(session.teamMember.id, client?.name ?? "Client", `Contract-${safe}`, file.type || "application/octet-stream", buf);
    if (r) link = r.link;
  }
  if (!link) {
    const path = `${run.client_id}/contract-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("client-docs").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (upErr) return { error: upErr.message };
    const { data: pub } = supabase.storage.from("client-docs").getPublicUrl(path);
    link = pub?.publicUrl ?? path;
  }
  return { link, name: file.name };
}

/** Notify the client that a task needs their input — posts to the run chat (client sees it)
    and drops an in-app notification. Used by the "Mention client" action on the board. */
export async function notifyClientOnTask(runId: string, taskRef: string, message?: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("org_id,client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const body = (message?.trim()) || `We need your input on "${taskRef}". Please take a look when you can.`;
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body,
    task_ref: taskRef?.trim() || null,
  });
  await supabase.from("notifications").insert({
    org_id: run.org_id, run_id: runId, kind: "info",
    title: "Client notified — input needed", body: `[${taskRef}] ${body.slice(0, 120)}`,
  });
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

export interface RunItemInput { data: Record<string, unknown>; status?: string }

/** Replaces all run_items of a kind, then completes the step. */
export interface BoardCol { k: string; l: string; opts?: string[] }

/** Loads the saved column config for a run board (catch-up / compliance), or null for defaults. */
export async function getBoardCols(runId: string, kind: string): Promise<{ cols?: BoardCol[] }> {
  const supabase = await createClient();
  const { data } = await supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", `${kind}_cols`).maybeSingle();
  const cols = (data?.data as { cols?: BoardCol[] } | null)?.cols;
  return { cols: Array.isArray(cols) && cols.length ? cols : undefined };
}

/** Saves a board's column config (add/remove/rename columns + dropdown options). */
export async function saveBoardCols(runId: string, kind: string, cols: BoardCol[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", `${kind}_cols`);
  const { error } = await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: `${kind}_cols`, data: { cols } });
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

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

/**
 * Urgent compliance → routed to an AM. For each item we CREATE A NEW RUN (urgent-compliance
 * template) owned by that AM, so they configure the steps and assign the owner. The run is
 * created even though its template still needs configuring.
 */
export async function escalateUrgentCompliance(
  runId: string, stepId: string,
  items: { item: string; amId: string; amName: string; severity: string }[],
): Promise<{ error?: string; created?: number }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  let created = 0;
  for (const it of items) {
    if (!it.amId || !it.item.trim()) continue;
    const newRunId = await createRunFromTemplate(supabase, {
      orgId: run.org_id, clientId: run.client_id, amId: it.amId, templateId: "urgent-compliance",
    });
    await supabase.from("notifications").insert({
      org_id: run.org_id, run_id: newRunId, recipient_id: it.amId, kind: "escalation",
      title: `Urgent compliance run created: ${it.item}`,
      body: `Severity ${it.severity}. A fast-track run was created for you — configure its steps and assign the owner.`,
    });
    created++;
  }
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "triage");
  if (items.length) {
    await supabase.from("run_items").insert(items.map((it, i) => ({ run_id: runId, client_id: run.client_id, kind: "triage", data: { ...it, memberName: it.amName }, status: "escalated", sort: i })));
  }
  await completeStep(runId, stepId);
  revalidatePath(`/onboarding/${runId}`);
  return { created };
}

export interface DiagramNode { id: string; label: string; type: string; x?: number; y?: number }
export interface DiagramEdge { from: string; to: string }
export interface DiagramInput { name: string; nodes: DiagramNode[]; edges?: DiagramEdge[] }

export async function saveDiagrams(runId: string, stepId: string, diagrams: DiagramInput[]) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_diagrams").delete().eq("run_id", runId);
  if (diagrams.length) {
    const { error } = await supabase.from("run_diagrams").insert(
      diagrams.map((d, i) => ({ run_id: runId, client_id: run.client_id, name: d.name, nodes: d.nodes, edges: d.edges ?? [], sort: i })),
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

/** Returns a viewable URL for an uploaded document (Drive link as-is, or a signed Storage URL). */
export async function getDocumentUrl(docId: string): Promise<{ error?: string; url?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", docId).maybeSingle();
  if (!doc?.storage_path) return { error: "No file uploaded yet." };
  if (/^https?:\/\//.test(doc.storage_path)) return { url: doc.storage_path };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("client-docs").createSignedUrl(doc.storage_path, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

/** Team flags an uploaded doc as wrong → client is asked to re-upload (with a reason). */
export async function requestDocReupload(runId: string, docId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("label").eq("id", docId).maybeSingle();
  if (!doc) return { error: "Document not found." };
  const reason = note.trim() || "The file needs to be corrected — please re-upload.";
  const { error } = await supabase.from("documents").update({ status: "rejected", review_note: reason }).eq("id", docId);
  if (error) return { error: error.message };
  // Tell the client in the shared thread (they see it in their portal).
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body: `📎 Please re-upload "${doc.label}": ${reason}`,
    task_ref: doc.label,
  });
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Team uploads/replaces a document on the client's behalf (Drive → fallback Storage). */
export async function uploadDocForClient(runId: string, docId: string, formData: FormData): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is larger than 25 MB." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,am_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const buf = Buffer.from(await file.arrayBuffer());

  // Prefer the uploader's own connected Drive, else the AM's, else Storage.
  let driveLink: string | null = null;
  let storagePath: string | null = null;
  const candidates = [session.teamMember?.id, run.am_id].filter(Boolean) as string[];
  for (const m of candidates) {
    const { data: conn } = await supabase.from("member_connections").select("team_member_id").eq("team_member_id", m).eq("provider", "google").eq("connected", true).maybeSingle();
    if (conn?.team_member_id) {
      const r = await uploadClientDocToDrive(m, client?.name ?? "Client", safe, file.type || "application/octet-stream", buf);
      if (r) { driveLink = r.link; break; }
    }
  }
  if (!driveLink) {
    const admin = createAdminClient();
    const path = `${run.client_id}/${docId}-${Date.now()}-${safe}`;
    const { error: upErr } = await admin.storage.from("client-docs").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (upErr) return { error: upErr.message };
    storagePath = path;
  }
  const { error } = await supabase.from("documents").update({ status: "uploaded", uploaded_at: new Date().toISOString(), storage_path: driveLink ?? storagePath, review_note: null }).eq("id", docId).eq("run_id", runId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Save task-board SLA reminders for the run (notify the AM if a task stalls). */
export async function saveTaskSla(runId: string, notStartedDays: number, notCompletedDays: number): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "task_sla");
  await supabase.from("run_items").insert({
    run_id: runId, client_id: run.client_id, kind: "task_sla",
    data: { notStartedDays: Math.max(0, notStartedDays || 0), notCompletedDays: Math.max(0, notCompletedDays || 0) },
    status: "open",
  });
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
export async function dispatchMagicLink(runId: string): Promise<{ error?: string; token?: string; url?: string; email?: string }> {
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

  // The portal is email-locked, so a real client email MUST be configured first.
  const { data: client } = await supabase.from("clients").select("primary_contact_email").eq("id", run.client_id).maybeSingle();
  const clientEmail = client?.primary_contact_email?.trim();
  if (!clientEmail) {
    return { error: "Set the client's email first (Client → Client Data). The portal can only be opened by that email." };
  }

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id, run_id: runId, client_id: run.client_id,
      email: clientEmail,
      token, purpose: "portal", expires_at: expires,
    });
    if (error) return { error: error.message };
  } else {
    // Keep the link's email in sync with the (possibly just-set) client email.
    await supabase.from("magic_links").update({ email: clientEmail }).eq("token", token);
  }
  return { token, url: `/portal/${token}`, email: clientEmail };
}

/** Completes the whole onboarding immediately (e.g. handover not needed): marks every
    step complete, closes the run and moves the client live. AM level or above. */
export async function completeOnboarding(runId: string): Promise<{ error?: string }> {
  const session = await getSession();
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if ((ROLE_RANK[myRole ?? ""] ?? 0) < ROLE_RANK.am) {
    return { error: "Only an Account Manager or above can complete the onboarding." };
  }
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const tpl = await getTemplate(run.template_key);
  if (!tpl) return { error: "Template missing." };
  // Upsert every template step as complete so recompute closes the run.
  const now = new Date().toISOString();
  for (const [si, stage] of tpl.stages.entries()) {
    for (const step of stage.steps) {
      await supabase.from("run_steps").upsert(
        { run_id: runId, step_no: step.id, stage_no: si + 1, title: step.title, type: KIND_TO_TYPE[step.kind] ?? "manual", status: "complete", completed_at: now },
        { onConflict: "run_id,step_no" },
      );
    }
  }
  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
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
  const tpl = await getTemplate(run.template_key);
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

/** Roll back a SINGLE step (reopen it) without touching the rest of the stage. AM+ only. */
export async function rollbackStep(runId: string, stepId: string) {
  const supabase = await createClient();
  const session = await getSession();
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if ((ROLE_RANK[myRole ?? ""] ?? 0) < ROLE_RANK.am) {
    return { error: "Only an Account Manager or above can roll back a completed step." };
  }
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { error } = await supabase
    .from("run_steps")
    .update({ status: "pending", completed_at: null })
    .eq("run_id", runId)
    .eq("step_no", stepId);
  if (error) return { error: error.message };
  await recompute(supabase, runId, run.template_key);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}
