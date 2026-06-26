"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { canManageCoa, canRevealAccessCredentials } from "@/lib/roles";
import { createClientDriveTree, sendGmailAs, uploadClientDocToDrive, getDriveCapableMemberId, shareDriveFolder, type DriveFolderNode } from "@/lib/google";
import { getTemplate, getAllTemplates } from "@/lib/templates-store";
import { createRunFromTemplate } from "@/lib/runs";
import { findTaxHead, suggestNextAm, findAlcHead, suggestNextAlc, suggestNextByRole } from "@/lib/capacity";
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
type StepLike = { who?: string[]; approval?: { by: string }; act?: { type?: string } };
function requiredRoleForStep(step: StepLike): string | null {
  // 2026-06-22 rule: ONLY the confirm/sign-off action (act.type "approve") is gated — to the
  // AM, which Senior / Team Lead can't override. Everything else (incl. Senior prep work like
  // building the COA, even when an AM later reviews it) is open to all team roles.
  if (step.act?.type === "approve") { const r = step.approval?.by ? WHO_TO_ROLE[step.approval.by.trim().toLowerCase()] : null; return r ?? "am"; }
  return null;
}
// 2026-06-23: gating OFF (user request) — every stage/step is actionable by ANY team role on
// EVERY template. Who does what is now decided when configuring/assigning the template, not
// enforced per-step in code. Flip back to true to restore the approval-only AM gate above.
const ENFORCE_STEP_ROLES = false;

/** Returns an error string if the signed-in member's role is below the step's required role. */
async function guardStepRole(step: StepLike): Promise<string | null> {
  if (!ENFORCE_STEP_ROLES) return null;
  const required = requiredRoleForStep(step);
  if (!required) return null;
  const session = await getSession();
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if (!myRole) return "You must be signed in.";
  if ((ROLE_RANK[myRole] ?? 0) >= (ROLE_RANK[required] ?? 99)) return null;
  const nice = (r: string) => r.replace(/_/g, " ");
  return `This step is reserved for ${nice(required)} or above. Your role (${nice(myRole)}) can't sign it off.`;
}

// ── Group mirror ─────────────────────────────────────────────────────────
// A client_group represents ONE proposal across N entities. Contract, call,
// MoM, agenda and welcome-email are deal-level artefacts (same across every
// entity), so when the team saves any of them on one sibling run we copy the
// data + step completion to every other sibling. Per-entity stages (intake,
// COA, docs, access, sign-off) are NOT mirrored — they stay isolated.
const GROUP_SHARED_ACT_TYPES = new Set(["contract", "call", "mom", "agenda", "welcome_email"]);

async function siblingRunIds(supabase: SupabaseClient, runId: string): Promise<string[]> {
  const { data: run } = await supabase.from("onboarding_runs").select("group_id").eq("id", runId).maybeSingle();
  if (!run?.group_id) return [];
  const { data: sibs } = await supabase
    .from("onboarding_runs").select("id")
    .eq("group_id", run.group_id).neq("id", runId);
  return (sibs ?? []).map((s) => s.id);
}

/** Returns the id of the step in `runId`'s template whose act.type matches — or null. */
async function findStepIdByActType(supabase: SupabaseClient, runId: string, actType: string): Promise<string | null> {
  const { data: r } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!r) return null;
  const tpl = await getTemplate(r.template_key);
  if (!tpl) return null;
  for (const stage of tpl.stages) {
    for (const st of stage.steps) {
      if (st.act?.type === actType) return st.id;
    }
  }
  return null;
}

/**
 * Mirrors a save+complete to every group sibling. `actType` is used to locate
 * the equivalent step in each sibling's template (templates can differ across
 * entities in a group, so we don't assume step ids match).
 */
async function mirrorToGroupSiblings(
  supabase: SupabaseClient,
  sourceRunId: string,
  actType: string,
  apply: (sib: { runId: string; clientId: string; stepId: string; templateKey: string }) => Promise<void>,
): Promise<void> {
  if (!GROUP_SHARED_ACT_TYPES.has(actType)) return;
  const sibs = await siblingRunIds(supabase, sourceRunId);
  if (!sibs.length) return;
  for (const sibRunId of sibs) {
    const { data: sib } = await supabase
      .from("onboarding_runs").select("client_id,template_key").eq("id", sibRunId).maybeSingle();
    if (!sib) continue;
    const sibStepId = await findStepIdByActType(supabase, sibRunId, actType);
    if (!sibStepId) continue;
    try {
      await apply({ runId: sibRunId, clientId: sib.client_id as string, stepId: sibStepId, templateKey: sib.template_key as string });
    } catch (e) {
      console.error("[group mirror]", actType, "→", sibRunId, e instanceof Error ? e.message : e);
    }
  }
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
/**
 * Re-share the client Drive folder with every current run_team member's email.
 * Idempotent — Drive treats already-shared emails as no-ops. Called whenever the
 * team composition changes (assign step, task assignment).
 */
async function shareDriveWithRunTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  orgId: string,
  clientId: string,
): Promise<void> {
  const { data: df } = await supabase
    .from("drive_folders")
    .select("tree")
    .eq("client_id", clientId)
    .maybeSingle();
  const folderId = (df?.tree as { id?: string } | null)?.id;
  if (!folderId) return;
  const { data: rt } = await supabase
    .from("run_team")
    .select("team_members(email)")
    .eq("run_id", runId);
  type Row = { team_members: { email: string | null } | { email: string | null }[] | null };
  const emails = (rt ?? [])
    .map((r: Row) => {
      const tm = Array.isArray(r.team_members) ? r.team_members[0] : r.team_members;
      return tm?.email ?? null;
    })
    .filter((e): e is string => !!e && e.includes("@"));
  if (!emails.length) return;
  const driveMember = await getDriveCapableMemberId(orgId, runId);
  if (!driveMember) return;
  await shareDriveFolder(driveMember, folderId, emails, "writer");
}

export async function assignStepMembers(
  runId: string,
  stepId: string,
  members: { id: string; name: string; role?: string }[],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key,am_id,org_id,client_id").eq("id", runId).maybeSingle();
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
  // Notify every just-assigned person so they see the run in their Action
  // Centre + can act on it immediately. Especially important for handover —
  // the receiving Team Lead needs to know a client is coming their way.
  const stepTitle = loc?.step.title ?? "an onboarding step";
  const actRole = (loc?.step.act?.role ?? "").toLowerCase();
  const isHandover = actRole.includes("handover");
  if (members.length) {
    await supabase.from("notifications").insert(
      members.map((m) => ({
        org_id: run.org_id,
        run_id: runId,
        recipient_id: m.id,
        kind: isHandover ? "escalation" : "task_assigned",
        title: isHandover ? "Client handover assigned to you" : "You were added to a run",
        body: isHandover ? `You're the destination for the handover: "${stepTitle}". Open the run to see what's next.` : stepTitle,
      })),
    );
  }

  // Handover routing: when the AM picks the destination, pre-assign that
  // person to the RECEIVER sign-off step in the same Handover stage so it
  // lands in their My Work and is gated to them. Also persist a handover_dest
  // run_item so the UI can show "Handing over to: <name>" on every other
  // handover step.
  if (isHandover && loc && members.length) {
    const dest = members[0];
    const stage = loc.tpl.stages[loc.stageNo - 1];
    // Find the LAST approve step in the handover stage — that's the receiver
    // sign-off (the onboarding AM sign-off comes earlier).
    const approveSteps = stage.steps.filter((s) => s.act?.type === "approve");
    const receiverStep = approveSteps[approveSteps.length - 1];
    if (receiverStep && receiverStep.id !== stepId) {
      await upsertStep(supabase, runId, run.template_key, receiverStep.id, {
        assignee_id: dest.id,
        payload: { handoverReceiver: { id: dest.id, name: dest.name } },
      });
      await supabase.from("notifications").insert({
        org_id: run.org_id,
        run_id: runId,
        recipient_id: dest.id,
        kind: "escalation",
        title: "Your handover sign-off is pending",
        body: `Once the onboarding AM signs off, your confirmation step "${receiverStep.title}" will be ready.`,
      });
    }
    await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "handover_dest");
    await supabase.from("run_items").insert(
      { run_id: runId, client_id: run.client_id, kind: "handover_dest", data: { id: dest.id, name: dest.name, role: dest.role ?? null }, status: "set", sort: 0 },
    );
  }

  if (run.am_id) {
    await supabase.from("run_team").upsert(
      { run_id: runId, team_member_id: run.am_id, role_in_run: "am" },
      { onConflict: "run_id,team_member_id" },
    );
  }

  // Auto-grant Drive access to the WHOLE run team (AM + TL + Senior + Junior + anyone
  // upserted via task assignment). Re-running this on each assign is idempotent on
  // the Drive side (already-shared emails are a no-op). Best-effort: assignment
  // succeeds even if the share call fails, but errors are logged.
  try {
    await shareDriveWithRunTeam(supabase, runId, run.org_id, run.client_id);
  } catch (e) {
    console.error("[Drive share] failed for run", runId, e);
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
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name,primary_contact_email").eq("id", run.client_id).maybeSingle();

  // Create the folder in the org's Drive account (same place client documents
  // upload to), preferring a run-team member with Google connected, else any
  // connected org account, else the current user.
  const driveMember = (await getDriveCapableMemberId(session.profile.org_id, runId)) ?? session.teamMember?.id;
  if (!driveMember) return { error: "Connect a Google account (Settings → Integrations) before creating Drive folders." };
  const tree = buildDriveTree(client?.name ?? "Client", opts.periodStart, opts.periodEnd);
  const driveTree = await createClientDriveTree(driveMember, tree);
  if (!driveTree) return { error: "Could not create Drive folders. Reconnect Google and make sure you have access to the master Drive folder." };
  await supabase.from("drive_folders").upsert({ client_id: run.client_id, tree: driveTree }, { onConflict: "client_id" });

  // Share the client folder (as editor) with the client and EVERY configured team member on the
  // run — AM, Team Lead, Senior, Junior, onboarding partner, etc. (2026-06-23: was AM/TL/Senior only).
  if (driveTree.id) {
    const { data: teamRows } = await supabase
      .from("run_team")
      .select("role_in_run, team_members(email)")
      .eq("run_id", runId);
    const teamEmails = (teamRows ?? [])
      .map((t: { team_members: { email?: string } | { email?: string }[] | null }) => {
        const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
        return tm?.email ?? null;
      })
      .filter(Boolean) as string[];
    const recipients = [client?.primary_contact_email ?? "", ...teamEmails].filter(Boolean);
    if (recipients.length) await shareDriveFolder(driveMember, driveTree.id, recipients, "writer");
  }
  if (opts.contract) {
    await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "contract");
    await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "contract", data: opts.contract });
  }
  await completeStep(runId, stepId);
  // Group mirror: copy contract data (and complete the sibling's contract step
  // if it has a standalone one). Drive folders stay per-entity.
  if (opts.contract) {
    await mirrorToGroupSiblings(supabase, runId, "contract", async (sib) => {
      await supabase.from("run_items").delete().eq("run_id", sib.runId).eq("kind", "contract");
      await supabase.from("run_items").insert({ run_id: sib.runId, client_id: sib.clientId, kind: "contract", data: opts.contract });
      await completeStep(sib.runId, sib.stepId);
    });
  }
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
    as run_items kind 'contract' — shown in the onboarding portal Live tab — then completes the step. */
export async function saveContractAnalysis(runId: string, stepId: string, contract: Record<string, unknown> | null): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "contract");
  if (contract) await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "contract", data: contract });
  await completeStep(runId, stepId);
  // Group mirror: contract = one proposal across the group. Copy to siblings.
  await mirrorToGroupSiblings(supabase, runId, "contract", async (sib) => {
    await supabase.from("run_items").delete().eq("run_id", sib.runId).eq("kind", "contract");
    if (contract) await supabase.from("run_items").insert({ run_id: sib.runId, client_id: sib.clientId, kind: "contract", data: contract });
    await completeStep(sib.runId, sib.stepId);
  });
  return {};
}

/** Records which accounting software we'll run this client on (set after the kickoff call).
    Saves onto the client so it surfaces in the playbook → Tools & Access, plus a run_items
    row for the run timeline, then completes the step. */
export async function saveAccountingSoftware(runId: string, stepId: string, software: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const value = software.trim();
  if (!value) return { error: "Pick the accounting software first." };
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { error } = await supabase.from("clients").update({ accounting_software: value }).eq("id", run.client_id);
  if (error) return { error: error.message };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "accounting_software");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "accounting_software", data: { software: value } });
  await completeStep(runId, stepId);
  return {};
}

/** Saves the access-grant configuration (FTA / bank / gateway / software …) as run_items
    (kind 'access'), one row per access, then completes the step. */
export async function saveAccess(runId: string, stepId: string, items: import("@/lib/access-sops").AccessItem[]): Promise<{ error?: string }> {
  type AccessItem = import("@/lib/access-sops").AccessItem;
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  // Re-saving the config rebuilds the rows — but must NOT wipe what the client already
  // entered (granted confirmations, and especially encrypted credentials). Carry those
  // forward by matching on the access-type id.
  const { data: existingRows } = await supabase.from("run_items").select("data,status").eq("run_id", runId).eq("kind", "access");
  const prevById = new Map<string, { data: AccessItem; status: string }>();
  (existingRows ?? []).forEach((r) => { const d = r.data as AccessItem; if (d?.id) prevById.set(d.id, { data: d, status: r.status }); });

  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "access");
  const clean = items.filter((it) => it.label?.trim()).map((it) => {
    const prev = prevById.get(it.id);
    if (!prev) return it;
    const carry: Partial<AccessItem> = {};
    // Keep the client's grant confirmation.
    if (prev.data.status === "granted" || prev.status === "granted") { carry.status = "granted"; if (prev.data.note) carry.note = prev.data.note; }
    // Keep stored credentials when this item is still in credentials mode.
    if (it.accessMode === "credentials" && prev.data.credPasswordEnc) {
      carry.credUsername = prev.data.credUsername;
      carry.credPasswordEnc = prev.data.credPasswordEnc;
      carry.credSavedAt = prev.data.credSavedAt;
    }
    return { ...it, ...carry };
  });
  if (clean.length) {
    const { error } = await supabase.from("run_items").insert(
      clean.map((it, i) => ({ run_id: runId, client_id: run.client_id, kind: "access", data: it, status: it.status ?? "requested", sort: i })),
    );
    if (error) return { error: error.message };
  }
  await completeStep(runId, stepId);
  return {};
}

/** Reveal the decrypted login the client stored for a credentials-mode access item.
    Team-only (the action runs server-side and requires a signed-in session). */
export async function revealAccessCredentials(runId: string, rowId: string): Promise<{ error?: string; username?: string; password?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  // Role gate: Senior, Team Lead, AM, Ops Head, and Master Admin can read a
  // client's stored login — they're the people who actually use it to do the
  // bookkeeping. Junior / intern stay blocked. Every reveal is audit-logged.
  const role = session.teamMember?.role ?? session.profile.role;
  if (!canRevealAccessCredentials(role)) return { error: "Only Senior, Team Lead, AM or admin can reveal stored logins." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("run_items").select("data").eq("id", rowId).eq("run_id", runId).eq("kind", "access").maybeSingle();
  if (!row) return { error: "Access item not found." };
  const d = row.data as import("@/lib/access-sops").AccessItem;
  if (!d.credPasswordEnc && !d.credUsername) return { error: "No credentials saved yet." };
  let password = "";
  try { password = d.credPasswordEnc ? decryptSecret(d.credPasswordEnc) : ""; }
  catch { return { error: "Could not decrypt — encryption key mismatch." }; }
  // Audit every reveal — who looked at which system's login, and when.
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: role,
    action: "access_credentials_revealed",
    module: "onboarding",
    resource_ref: `Revealed login for "${d.label ?? "Access"}"${d.systemName ? ` (${d.systemName})` : ""}`,
    resource_id: rowId,
  });
  return { username: d.credUsername ?? "", password };
}

/** Saves a call step's recording link + notes into the step payload, then completes it.
    These are what the MoM generator reads — without them the MoM can't be generated. */
export async function saveCallNotes(runId: string, stepId: string, recording: string, notes: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const loc = await locate(run.template_key, stepId);
  if (loc) { const denied = await guardStepRole(loc.step); if (denied) return { error: denied }; }
  const payload = { recording: recording.trim(), notes: notes.trim() };
  const r = await upsertStep(supabase, runId, run.template_key, stepId, {
    status: "complete",
    payload,
    completed_at: new Date().toISOString(),
  });
  if (r.error) return r;
  await recompute(supabase, runId, run.template_key);
  // Group mirror: discovery call = one conversation for the whole group.
  await mirrorToGroupSiblings(supabase, runId, "call", async (sib) => {
    await upsertStep(supabase, sib.runId, sib.templateKey, sib.stepId, {
      status: "complete",
      payload,
      completed_at: new Date().toISOString(),
    });
    await recompute(supabase, sib.runId, sib.templateKey);
    revalidatePath(`/onboarding/${sib.runId}`);
  });
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

/** Returns the Tax Head + the suggested least-loaded tax-team member for an
 *  auto-assign action in the urgent-compliance triage modal. Tax-flagged
 *  rows default to the Tax Head; the team head clicks "Auto-assign" to push
 *  the row to the lowest-load AM in his subtree. */
export async function suggestTaxAssignee(): Promise<{ head?: { id: string; name: string } | null; suggested?: { id: string; name: string } | null; error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const head = await findTaxHead(session.profile.org_id);
  const suggested = await suggestNextAm(session.profile.org_id);
  return {
    head: head ? { id: head.id, name: head.name } : null,
    suggested: suggested ? { id: suggested.id, name: suggested.name } : null,
  };
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

/**
 * A tracked compliance item is due → create a lightweight RENEWAL run (compliance-renewal
 * template: one pre-built task, no configuration) for the client's AM. It lands in their
 * My Work. Used both manually (button on a compliance row) and automatically (the cron).
 */
export async function createComplianceRenewalRun(
  runId: string, item: { label?: string; type?: string; date?: string },
): Promise<{ error?: string; runId?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id,am_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const label = (item.label || item.type || "Compliance item").trim();
  const newRunId = await createRunFromTemplate(supabase, {
    orgId: run.org_id, clientId: run.client_id, amId: run.am_id ?? null,
    templateId: "compliance-renewal", targetCompletion: item.date ?? null,
  });
  // Record what this renewal is for, so the run shows the specific document.
  await supabase.from("run_items").insert({ run_id: newRunId, client_id: run.client_id, kind: "renewal_for", data: { label, type: item.type ?? null, date: item.date ?? null } });
  if (run.am_id) {
    await supabase.from("notifications").insert({
      org_id: run.org_id, run_id: newRunId, recipient_id: run.am_id, kind: "escalation",
      title: `Renewal due: ${label}`,
      body: `${label}${item.date ? ` is due ${item.date}` : ""}. A renewal task was created in your My Work — renew it and update the file in Drive.`,
    });
  }
  revalidatePath(`/onboarding/${runId}`);
  revalidatePath("/my-work");
  return { runId: newRunId };
}

/** Suggest the default ALC catch-up owner — Anju by default, else the least-loaded ALC team member. */
export async function suggestCatchupAssignee(): Promise<{ head?: { id: string; name: string } | null; suggested?: { id: string; name: string } | null; error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const head = await findAlcHead(session.profile.org_id);
  const suggested = await suggestNextAlc(session.profile.org_id);
  return {
    head: head ? { id: head.id, name: head.name } : null,
    suggested: suggested ? { id: suggested.id, name: suggested.name } : null,
  };
}

/**
 * Resolve the catch-up routing target — locked to the Tax Head (Gautham).
 * Used by the new yes/no catch-up config modal where the AM cannot be changed.
 */
export async function getCatchupGautham(): Promise<{ id: string; name: string } | null> {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  const head = await findTaxHead(session.profile.org_id);
  return head ? { id: head.id, name: head.name } : null;
}

/** Suggest a role default for the Assign Roles step (used to pre-select Senior/Junior/Team Lead). */
export async function suggestAssignee(role: string, excludeIds: string[] = []): Promise<{ id: string; name: string; currentLoad: number } | null> {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  return await suggestNextByRole(session.profile.org_id, role, excludeIds);
}

/**
 * Urgent compliance v2 — yes/no + multi-service picker.
 * For each selected service (ct-registration, vat-registration, ct-filing, vat-filing) we
 * spin up a parallel run from that service's template, assigned to the least-loaded tax-team
 * member (capacity-based, defaults to a Gautham-team member). If "no urgent items", marks the
 * step complete with no runs created.
 */
export async function escalateUrgentComplianceServices(
  runId: string,
  stepId: string,
  hasUrgent: boolean,
  services: string[],
): Promise<{ error?: string; created?: number; runIds?: string[] }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };

  if (!hasUrgent) {
    // record the decision so we can show "no urgent compliance" on the step
    await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "urgent_decision");
    await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "urgent_decision", data: { hasUrgent: false, services: [] }, status: "skipped" });
    await completeStep(runId, stepId);
    revalidatePath(`/onboarding/${runId}`);
    return { created: 0, runIds: [] };
  }

  const allowed = new Set(["ct-registration", "vat-registration", "ct-filing", "vat-filing", "audit"]);
  const picked = services.filter((s) => allowed.has(s));
  if (!picked.length) return { error: "Pick at least one service to escalate, or choose No urgent compliance." };

  const head = await findTaxHead(run.org_id);
  const newIds: string[] = [];
  for (const service of picked) {
    // Audit reuses the CT filing template under the hood (per product decision).
    const tplId = service === "audit" ? "ct-filing" : service;
    const owner = await suggestNextAm(run.org_id);
    const ownerId = owner?.id ?? head?.id ?? null;
    const newRunId = await createRunFromTemplate(supabase, {
      orgId: run.org_id, clientId: run.client_id, amId: ownerId, templateId: tplId,
    });
    newIds.push(newRunId);
    if (ownerId) {
      const label = service === "audit" ? "Statutory audit" : service.replace("-", " ");
      await supabase.from("notifications").insert({
        org_id: run.org_id, run_id: newRunId, recipient_id: ownerId, kind: "escalation",
        title: `Urgent compliance run created (${label})`,
        body: `Auto-assigned by capacity. Open the run and start collecting the documents — Assign Roles is your first step.`,
      });
    }
  }

  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "urgent_decision");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "urgent_decision", data: { hasUrgent: true, services: picked, runIds: newIds }, status: "escalated" });
  await completeStep(runId, stepId);
  revalidatePath(`/onboarding/${runId}`);
  return { created: newIds.length, runIds: newIds };
}

/**
 * Catch-up handed to a DIFFERENT team → create a dedicated catch-up run for that team's AM,
 * pre-seeded with the catch-up tasks. The AM then configures and assigns. Completes the origin step.
 */
export async function escalateCatchup(
  runId: string, stepId: string, amId: string, amName: string,
  tasks: Record<string, string>[],
): Promise<{ error?: string; runId?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  if (!amId) return { error: "Pick the Account Manager for the catch-up team." };
  const newRunId = await createRunFromTemplate(supabase, {
    orgId: run.org_id, clientId: run.client_id, amId, templateId: "catchup",
  });
  const seed = tasks.filter((t) => Object.values(t).some((v) => v));
  if (seed.length) {
    await supabase.from("run_items").insert(seed.map((t, i) => ({ run_id: newRunId, client_id: run.client_id, kind: "catchup", data: t, status: t.status ?? "open", sort: i })));
  }
  await supabase.from("notifications").insert({
    org_id: run.org_id, run_id: newRunId, recipient_id: amId, kind: "escalation",
    title: "Catch-up accounting run created",
    body: `${amName}, a catch-up run was created for your team${seed.length ? ` with ${seed.length} task(s) pre-seeded` : ""}. Configure the board and assign the owners.`,
  });
  await completeStep(runId, stepId);
  revalidatePath(`/onboarding/${runId}`);
  return { runId: newRunId };
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
  due?: string;       // ISO date "YYYY-MM-DD" stored in tasks.due_date
  notes?: string;     // free-text notes shown on the simplified board
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

/** Save the run's configurable task-status options (the Status dropdown choices). */
export async function saveTaskStatuses(runId: string, statuses: string[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const clean = statuses.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return { error: "Keep at least one status." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "task_statuses");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "task_statuses", data: { statuses: clean }, status: "open" });
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
  // Email the client so they're alerted outside the portal too (best-effort).
  await sendClientEmail(
    runId,
    `Action needed: please re-upload "${doc.label}"`,
    `Hello,\n\nWe need you to re-upload one document for your onboarding:\n\n• ${doc.label}\nReason: ${reason}\n\nPlease open your secure portal → Documents and re-upload the corrected file. The item is highlighted there.\n\nThank you,\nFinanshels`,
  ).catch(() => {});
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

  // Prefer the uploader's own connected Drive, else the AM's, else any connected
  // account in the org (so docs reach Drive even if neither has connected). Else Storage.
  let driveLink: string | null = null;
  let storagePath: string | null = null;
  const orgFallback = await getDriveCapableMemberId(session.profile.org_id, runId);
  const candidates = [session.teamMember?.id, run.am_id, orgFallback].filter((v, i, a) => v && a.indexOf(v) === i) as string[];
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

/** Close any open docs_overdue / access_overdue admin task for this run when all
 *  pending items of that kind are accounted for. Also stamp a history note on
 *  any still-open admin task so the audit trail records the manual receipt. */
async function patchOverdueAdminTask(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  kind: "docs_overdue" | "access_overdue",
  historyNote: string,
  pendingRemaining: number,
) {
  const { data: openRows } = await admin
    .from("admin_tasks")
    .select("id,history")
    .eq("run_id", runId)
    .eq("kind", kind)
    .eq("status", "open");
  for (const t of openRows ?? []) {
    const history = Array.isArray(t.history) ? (t.history as unknown[]) : [];
    const next = [...history, { at: new Date().toISOString(), action: "item_received_outside_portal", notes: historyNote }];
    if (pendingRemaining === 0) {
      await admin.from("admin_tasks").update({ status: "closed", closed_at: new Date().toISOString(), history: next, notes: historyNote }).eq("id", t.id);
    } else {
      await admin.from("admin_tasks").update({ history: next }).eq("id", t.id);
    }
  }
}

/** Team marks a doc as received outside the portal (email / WhatsApp / etc).
 *  Sets status='uploaded' + audit fields, posts a system run message, and
 *  patches any open docs_overdue admin task — closing it if no docs are pending. */
export async function markDocReceivedOutside(runId: string, docId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Add a short note (where you received it and from whom)." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("label").eq("id", docId).maybeSingle();
  if (!doc) return { error: "Document not found." };
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("documents").update({
    status: "uploaded",
    received_outside_portal: true,
    received_note: trimmed,
    received_at: nowIso,
    received_by: session.teamMember?.id ?? null,
    uploaded_at: nowIso,
  }).eq("id", docId).eq("run_id", runId);
  if (error) return { error: error.message };
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body: `📥 "${doc.label}" marked received outside the portal — note: ${trimmed}`,
    task_ref: doc.label,
  });
  // Patch any open docs_overdue task; close if no pending docs remain.
  const admin = createAdminClient();
  const { data: pending } = await admin.from("documents").select("id").eq("run_id", runId).eq("status", "pending").eq("required", true);
  await patchOverdueAdminTask(admin, runId, "docs_overdue", `${doc.label} — ${trimmed}`, pending?.length ?? 0);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Team marks an access item as received outside the portal. */
export async function markAccessReceivedOutside(runId: string, rowId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Add a short note." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("run_items").select("data,id").eq("id", rowId).eq("run_id", runId).eq("kind", "access").maybeSingle();
  if (!row) return { error: "Access row not found." };
  const data = (row.data ?? {}) as { items?: Array<Record<string, unknown>>; label?: string; systemName?: string };
  const items = Array.isArray(data.items) ? data.items : [];
  // The "items" array uses item.id as the per-row id; the run_items row itself is rowId.
  // Mark every still-pending item on this row as received (the panel surfaces one row per access type).
  const labelOf = (it: Record<string, unknown>) => String(it.label ?? "");
  let touched = "";
  const nextItems = items.map((it) => {
    if (it.confirmed) return it;
    touched = touched || labelOf(it) || String(data.label ?? "Access");
    return {
      ...it,
      confirmed: true,
      receivedOutsidePortal: true,
      receivedNote: trimmed,
      receivedAt: new Date().toISOString(),
    };
  });
  // If the row stores no item array (older shape), update the row's top-level status directly.
  const patch: Record<string, unknown> = nextItems.length
    ? { data: { ...data, items: nextItems, status: "granted" }, status: "granted" }
    : { data: { ...data, status: "granted", confirmed: true, receivedOutsidePortal: true, receivedNote: trimmed, receivedAt: new Date().toISOString() }, status: "granted" };
  const labelForMsg = touched || String(data.label ?? data.systemName ?? "Access");
  const { error } = await supabase.from("run_items").update(patch).eq("id", rowId);
  if (error) return { error: error.message };
  await supabase.from("run_messages").insert({
    run_id: runId,
    author_id: session.teamMember?.id ?? null,
    author_name: session.teamMember?.full_name ?? session.email,
    author_role: session.profile.role,
    body: `📥 ${labelForMsg} access marked received outside the portal — note: ${trimmed}`,
    task_ref: labelForMsg,
  });
  // Count any access row that still has at least one unconfirmed item.
  const admin = createAdminClient();
  const { data: allAccess } = await admin.from("run_items").select("data").eq("run_id", runId).eq("kind", "access");
  let pendingCount = 0;
  for (const r of allAccess ?? []) {
    const d = (r.data ?? {}) as { items?: Array<{ confirmed?: boolean; enabled?: boolean }>; status?: string; confirmed?: boolean };
    if (Array.isArray(d.items) && d.items.length) {
      if (d.items.some((it) => it.enabled !== false && !it.confirmed)) pendingCount++;
    } else if (d.status !== "granted" && !d.confirmed) {
      pendingCount++;
    }
  }
  await patchOverdueAdminTask(admin, runId, "access_overdue", `${labelForMsg} — ${trimmed}`, pendingCount);
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Adds a free-text follow-up note to a doc. Does NOT change status — purely
 *  extends the next auto-task window via documents.followup_note_at. */
export async function addDocFollowupNote(runId: string, docId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Add a short note." };
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({
    followup_note: trimmed,
    followup_note_at: new Date().toISOString(),
  }).eq("id", docId).eq("run_id", runId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Adds a follow-up note to a specific access item inside a run_items row. */
export async function addAccessFollowupNote(runId: string, rowId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Add a short note." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("run_items").select("data").eq("id", rowId).eq("run_id", runId).eq("kind", "access").maybeSingle();
  if (!row) return { error: "Access row not found." };
  const data = (row.data ?? {}) as { items?: Array<Record<string, unknown>> };
  const items = Array.isArray(data.items) ? data.items : [];
  const nowIso = new Date().toISOString();
  const patched = items.length
    ? { ...data, items: items.map((it) => it.confirmed ? it : { ...it, followupNote: trimmed, followupNoteAt: nowIso }) }
    : { ...data, followupNote: trimmed, followupNoteAt: nowIso };
  const { error } = await supabase.from("run_items").update({ data: patched }).eq("id", rowId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Adds a follow-up note to a task. Does NOT change status — purely extends
 *  the next auto-task window via tasks.followup_note_at. */
export async function addTaskFollowupNote(runId: string, taskId: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Add a short note." };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({
    followup_note: trimmed,
    followup_note_at: new Date().toISOString(),
  }).eq("id", taskId).eq("run_id", runId);
  if (error) return { error: error.message };
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/** Lists the org's SOPs / templates for linking to internal projects & tasks. */
export async function listSops(): Promise<{ sops: { id: string; title: string; flow: string | null; category: string | null; scope: string | null }[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { sops: [] };
  const supabase = await createClient();
  const { data } = await supabase
    .from("sops")
    .select("id,title,flow,category,scope")
    .eq("org_id", session.profile.org_id)
    .order("title");
  return { sops: (data ?? []) as { id: string; title: string; flow: string | null; category: string | null; scope: string | null }[] };
}

/** Lightweight template list (id + name) for linking a template to a project task. */
export async function listTemplatesLite(): Promise<{ templates: { id: string; name: string }[] }> {
  const all = await getAllTemplates();
  return { templates: all.map((t) => ({ id: t.id, name: t.name })) };
}

/** Saves the SOPs/templates linked to this run's internal project & tasks. */
export async function saveLinkedSops(runId: string, sops: { id: string; title: string }[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "linked_sops");
  if (sops.length) {
    await supabase.from("run_items").insert(
      sops.map((s, i) => ({ run_id: runId, client_id: run.client_id, kind: "linked_sops", data: s, status: "open", sort: i })),
    );
  }
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/**
 * Creates (or returns) an OPTIONAL link the team can send to the Sales team so
 * they can drop documents they already collected straight into the client's
 * Drive folder — marked as received. Not part of any template; generated on demand.
 */
export async function createSalesUploadLink(runId: string): Promise<{ error?: string; url?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: existing } = await supabase.from("magic_links").select("token").eq("run_id", runId).eq("purpose", "sales_upload").maybeSingle();
  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 30 * 86_400_000).toISOString(); // 30-day window
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id, run_id: runId, client_id: run.client_id,
      email: "sales-upload", token, purpose: "sales_upload", expires_at: expires,
    });
    if (error) return { error: error.message };
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")).replace(/\/$/, "");
  return { url: base ? `${base}/sales-upload/${token}` : `/sales-upload/${token}` };
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
  const ownerKind = input.ownerKind ?? "team";
  const ownerId = ownerKind === "client" ? null : (input.ownerId || null);
  const { error } = await supabase.from("tasks").insert({
    org_id: run.org_id, run_id: runId, client_id: run.client_id,
    title: input.title.trim(),
    type: input.type ?? "internal",
    status: input.status ?? "not_started",
    owner_kind: ownerKind,
    owner_id: ownerId,
    due_date: input.due?.trim() || null,
    notes: input.notes?.trim() || null,
    client_visible: input.clientVisible ?? false,
    sort: (maxRow?.sort ?? 0) + 1,
  });
  if (error) return { error: error.message };
  if (ownerId) await onboardTaskOwner(supabase, run.org_id, runId, ownerId, input.title.trim());
  revalidatePath(`/onboarding/${runId}`);
  return {};
}

/**
 * Bring a task owner into the run: upsert them into run_team (so the run shows
 * in their list + they appear in RunChat) and notify them that a task is on
 * their plate. Gautham feedback 2026-06-24.
 */
async function onboardTaskOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  runId: string,
  ownerId: string,
  taskTitle: string,
) {
  const { data: tm } = await supabase
    .from("team_members")
    .select("role,full_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (tm) {
    await supabase
      .from("run_team")
      .upsert(
        { run_id: runId, team_member_id: ownerId, role_in_run: tm.role ?? "senior" },
        { onConflict: "run_id,team_member_id" },
      );
  }
  await supabase.from("notifications").insert({
    org_id: orgId,
    run_id: runId,
    recipient_id: ownerId,
    kind: "task_assigned",
    title: "New task assigned to you",
    body: taskTitle,
  });
  // Pull the run's client_id so the helper can find the right Drive folder.
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (run?.client_id) {
    try {
      await shareDriveWithRunTeam(supabase, runId, orgId, run.client_id);
    } catch (e) {
      console.error("[Drive share / task owner] failed for run", runId, e);
    }
  }
}

/** Edit any field of a task. */
export async function updateTask(runId: string, taskId: string, patch: TaskInput): Promise<{ error?: string }> {
  const supabase = await createClient();
  const upd: Record<string, unknown> = {};
  if (patch.title !== undefined) upd.title = patch.title.trim();
  if (patch.type !== undefined) upd.type = patch.type;
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.due !== undefined) upd.due_date = patch.due?.trim() || null;
  if (patch.notes !== undefined) upd.notes = patch.notes ?? null;
  if (patch.clientVisible !== undefined) upd.client_visible = patch.clientVisible;
  if (patch.boardColumn !== undefined) upd.board_column = patch.boardColumn || null;
  let newOwnerId: string | null = null;
  let ownerChanged = false;
  if (patch.ownerKind !== undefined) {
    upd.owner_kind = patch.ownerKind;
    newOwnerId = patch.ownerKind === "client" ? null : (patch.ownerId || null);
    upd.owner_id = newOwnerId;
    ownerChanged = true;
  } else if (patch.ownerId !== undefined) {
    newOwnerId = patch.ownerId || null;
    upd.owner_id = newOwnerId;
    ownerChanged = true;
  }
  if (!Object.keys(upd).length) return {};
  // Compare against previous owner so we only notify on an actual change.
  let prevOwnerId: string | null = null;
  if (ownerChanged) {
    const { data: prev } = await supabase.from("tasks").select("owner_id,title").eq("id", taskId).maybeSingle();
    prevOwnerId = (prev?.owner_id as string | null) ?? null;
    if (newOwnerId && newOwnerId !== prevOwnerId) {
      const { data: run } = await supabase.from("onboarding_runs").select("org_id").eq("id", runId).maybeSingle();
      const title = (patch.title ?? prev?.title ?? "Task").trim();
      if (run?.org_id) await onboardTaskOwner(supabase, run.org_id, runId, newOwnerId, title);
    }
  }
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

/** Creates (or reuses) the onboarding portal magic link for this run. */
export async function dispatchMagicLink(runId: string, additionalEmails?: string[]): Promise<{ error?: string; token?: string; url?: string; email?: string; clientName?: string; contactName?: string; altEmails?: string[] }> {
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("client_id,org_id,group_id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { error: "Run not found." };

  const { data: existing } = await supabase
    .from("magic_links")
    .select("token,alt_emails,group_id")
    .eq("run_id", runId)
    .eq("purpose", "portal")
    .maybeSingle();

  // The portal is email-locked, so a real client email MUST be configured first.
  const { data: client } = await supabase.from("clients").select("name,owner_name,primary_contact_email").eq("id", run.client_id).maybeSingle();
  const clientEmail = client?.primary_contact_email?.trim();
  if (!clientEmail) {
    return { error: "Set the client's email first (Client → Client Data). The portal can only be opened by that email." };
  }

  // Merge any additional teammate emails into alt_emails (de-duplicated, lower-cased,
  // never duplicating the primary email). Empty array clears nothing — we always
  // append rather than replace, so the AM can re-dispatch without losing prior invites.
  const cleanExtras = (additionalEmails ?? [])
    .map((e) => (e ?? "").trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .filter((e) => e !== clientEmail.toLowerCase());

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id, run_id: runId, client_id: run.client_id,
      group_id: run.group_id ?? null,
      email: clientEmail,
      token, purpose: "portal", expires_at: expires,
      alt_emails: cleanExtras.length ? Array.from(new Set(cleanExtras)) : [],
    });
    if (error) return { error: error.message };
  } else {
    const current = ((existing?.alt_emails ?? []) as string[]).map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean);
    const merged = Array.from(new Set([...current, ...cleanExtras]));
    // Keep the link's email in sync with the (possibly just-set) client email,
    // and merge any new teammate invites into alt_emails. Also stamp group_id
    // if the run belongs to a group and the legacy link lacked it (otherwise
    // the portal switcher won't render on existing dispatched links).
    const patch: Record<string, unknown> = { email: clientEmail, alt_emails: merged };
    if (run.group_id && !existing?.group_id) patch.group_id = run.group_id;
    await supabase.from("magic_links").update(patch).eq("token", token);
  }

  // Read the final alt_emails back so the caller can show what's saved.
  const { data: final } = await supabase.from("magic_links").select("alt_emails").eq("token", token).maybeSingle();
  const altEmails = ((final?.alt_emails ?? []) as string[]).filter(Boolean);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const absUrl = appUrl ? `${appUrl.replace(/\/+$/, "")}/portal/${token}` : `/portal/${token}`;
  return {
    token,
    url: absUrl,
    email: clientEmail,
    altEmails,
    clientName: client?.name ?? undefined,
    contactName: (client?.owner_name as string | undefined) ?? undefined,
  };
}

/**
 * Creates (or reuses) the PUBLIC INTAKE link for this run — a no-login token-only
 * URL (different from the OTP-gated portal). The client opens /intake/<token>,
 * fills the form, answers autosave field-by-field. Team sees them live in the
 * run view.
 */
export async function dispatchIntakeLink(runId: string): Promise<{
  error?: string;
  token?: string;
  url?: string;
  email?: string;
  clientName?: string;
  contactName?: string;
}> {
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
    .eq("purpose", "intake")
    .maybeSingle();

  const { data: client } = await supabase
    .from("clients")
    .select("name,owner_name,primary_contact_email")
    .eq("id", run.client_id)
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id,
      run_id: runId,
      client_id: run.client_id,
      email: client?.primary_contact_email ?? null,
      token,
      purpose: "intake",
      expires_at: expires,
    });
    if (error) return { error: error.message };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const absUrl = appUrl ? `${appUrl.replace(/\/+$/, "")}/intake/${token}` : `/intake/${token}`;
  return {
    token,
    url: absUrl,
    email: (client?.primary_contact_email as string | null) ?? undefined,
    clientName: client?.name ?? undefined,
    contactName: (client?.owner_name as string | undefined) ?? undefined,
  };
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

/**
 * Pause SLA + compliance alerts for this run because work is blocked upstream
 * (catch-up incomplete, client docs pending, FTA portal outage…). The crons
 * skip blocked runs entirely until `setRunBlocked(runId, null)` clears it.
 *
 * AM-level and above only — Senior/Junior shouldn't unilaterally silence
 * deadline alerts on a compliance run.
 */
export async function setRunBlocked(runId: string, reason: string | null): Promise<{ error?: string; blocked?: boolean }> {
  const supabase = await createClient();
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const myRole = session?.teamMember?.role ?? session?.profile.role;
  if ((ROLE_RANK[myRole ?? ""] ?? 0) < ROLE_RANK.am) {
    return { error: "Only an Account Manager or above can pause a run." };
  }

  const trimmed = (reason ?? "").trim();
  const patch = trimmed
    ? { blocked_reason: trimmed, blocked_at: new Date().toISOString(), blocked_by: session.teamMember?.id ?? null }
    : { blocked_reason: null, blocked_at: null, blocked_by: null };

  const { error } = await supabase.from("onboarding_runs").update(patch).eq("id", runId);
  if (error) return { error: error.message };

  // Audit trail so we can answer "who paused this and why".
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: myRole ?? "unknown",
    action: trimmed ? "run_blocked" : "run_unblocked",
    resource_id: runId,
    resource_type: "onboarding_run",
    details: trimmed ? { reason: trimmed } : {},
  });

  revalidatePath(`/onboarding/${runId}`);
  return { blocked: !!trimmed };
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

/**
 * Push the run's finalised COA into the connected Zoho Books org. Used by
 * step t3.3 / m3.3 (act.type='zoho'). Requires:
 *   - someone in this org has Zoho connected via My Connections
 *   - the run has a saved COA (coa_instances.accounts non-empty)
 *
 * Returns the per-line counts; failures don't abort.
 */
export async function pushCoaToZoho(
  runId: string,
  stepId?: string,
): Promise<{ error?: string; created?: number; skipped?: number; failed?: number; zohoOrganizationId?: string; errors?: Array<{ code: string; account: string; reason: string }> }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["senior", "team_lead", "am", "ops_head", "admin"].includes(role))
    return { error: "Only a Senior or above can push the COA to Zoho." };

  const supabase = await createClient();
  const { data: coa } = await supabase
    .from("coa_instances")
    .select("accounts")
    .eq("run_id", runId)
    .maybeSingle();
  const lines = ((coa?.accounts ?? []) as Array<{ code: string; account: string; section: string; description?: string; include?: boolean }>)
    .filter((l) => l.include !== false && l.account?.trim());
  if (!lines.length) return { error: "No COA saved on this run yet — finalise the COA first." };

  const { pushCoaToZohoBooks } = await import("@/lib/zoho-books");
  try {
    const result = await pushCoaToZohoBooks({
      orgId: session.profile.org_id,
      pushedByTeamMemberId: session.teamMember?.id ?? null,
      lines,
    });
    await supabase.from("audit_events").insert({
      org_id: session.profile.org_id,
      actor: session.teamMember?.full_name ?? session.email,
      actor_role: role,
      action: "coa_pushed_to_zoho",
      module: "onboarding",
      resource_ref: `Pushed COA to Zoho Books (${result.created} created, ${result.skipped} already there, ${result.failed} failed)`,
      resource_id: runId,
      resource_type: "run",
      details: { zoho_org: result.zohoOrganizationId, errors: result.errors.slice(0, 20) },
    });
    if (stepId && result.failed === 0) await completeStep(runId, stepId);
    revalidatePath(`/onboarding/${runId}`);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Zoho push failed." };
  }
}
