"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import type { AiFeature, FeatureModel } from "@/lib/ai-config";
import { runLeadSync, type LeadSyncResult } from "@/lib/lead-sync";
import type { Role } from "@/lib/types";

async function orgGuard() {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  if (session.profile.role !== "admin" && session.profile.role !== "ops_head") return null;
  return session.profile.org_id;
}

/** Save the max-tasks ceiling for an AM (Master Admin / Ops Head only). */
export async function saveAmCapacity(input: { teamMemberId: string; maxTasks: number }): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Only the Master Admin or Ops Head can change capacity." };
  if (!input.teamMemberId) return { error: "Pick a team member." };
  const max = Math.max(0, Math.floor(Number(input.maxTasks) || 0));
  const admin = createAdminClient();
  const { error } = await admin
    .from("am_capacity")
    .upsert(
      { org_id: orgId, team_member_id: input.teamMemberId, max_tasks: max, updated_at: new Date().toISOString() },
      { onConflict: "org_id,team_member_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Master Admin / Ops Head: set the same max-tasks ceiling for EVERY current
 * tax-team member at once. Pulls the current capacity list (head + subtree +
 * extras) and upserts am_capacity for each.
 */
export async function setAllTaxCapacity(maxTasks: number): Promise<{ error?: string; ok?: boolean; count?: number }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Only the Master Admin or Ops Head can change capacity." };
  const max = Math.max(0, Math.floor(Number(maxTasks) || 0));
  const { getAmCapacityList } = await import("@/lib/capacity");
  const rows = await getAmCapacityList(orgId);
  if (!rows.length) return { error: "No tax-team members configured yet." };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const upserts = rows.map((r) => ({ org_id: orgId, team_member_id: r.id, max_tasks: max, updated_at: now }));
  const { error } = await admin
    .from("am_capacity")
    .upsert(upserts, { onConflict: "org_id,team_member_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true, count: rows.length };
}

/** Master Admin / Ops Head: set the org-level default new-member capacity ceiling. */
export async function saveTaxCapacityDefault(defaultMax: number): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Only the Master Admin or Ops Head can change capacity." };
  const max = Math.max(0, Math.floor(Number(defaultMax) || 0));
  const admin = createAdminClient();
  const { error } = await admin.from("orgs").update({ tax_capacity_default: max }).eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Master Admin: manually override the current load for a tax-team member (null = revert to auto). */
export async function saveLoadOverride(teamMemberId: string, override: number | null): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Only the Master Admin or Ops Head can change capacity." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("am_capacity")
    .upsert(
      { org_id: orgId, team_member_id: teamMemberId, load_override: override, updated_at: new Date().toISOString() },
      { onConflict: "org_id,team_member_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Master Admin: add a team member to the tax-team capacity list manually
 *  (for people not in the Tax Head's org-chart subtree). */
export async function addTaxTeamMember(teamMemberId: string): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Master Admin / Ops Head only." };
  if (!teamMemberId) return { error: "Pick a team member." };
  const session = await getSession();
  const admin = createAdminClient();
  const { error } = await admin
    .from("tax_team_extras")
    .upsert(
      { org_id: orgId, team_member_id: teamMemberId, added_by: session?.profile.team_member_id ?? null },
      { onConflict: "org_id,team_member_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeTaxTeamMember(teamMemberId: string): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Master Admin / Ops Head only." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("tax_team_extras")
    .delete()
    .eq("org_id", orgId)
    .eq("team_member_id", teamMemberId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Active members not yet on the tax-team capacity list — for the picker. */
export async function listTaxAddCandidates(): Promise<Array<{ id: string; name: string; role: string; title: string | null }>> {
  const orgId = await orgGuard();
  if (!orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("team_members")
    .select("id,full_name,role,title")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("full_name");
  return (data ?? []).map((m) => ({ id: m.id, name: m.full_name, role: m.role, title: m.title }));
}

/** Master-Admin-only guard (lead automation rules). */
async function masterGuard() {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  const role = session.teamMember?.role ?? session.profile.role;
  if (role !== "admin") return null;
  return session.profile.org_id;
}

export interface LeadSyncInput {
  enabled: boolean;
  gmailLabel: string;
  matchFrom?: string | null;
  matchSubjectPrefix?: string | null;
  services: string[];
  mailboxMemberId?: string | null;
}

/** Save the email → lead automation rules (Master Admin only). */
export async function saveLeadSyncConfig(input: LeadSyncInput): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await masterGuard();
  if (!orgId) return { error: "Only the Master Admin can change these rules." };
  const admin = createAdminClient();
  const { error } = await admin.from("lead_sync_config").upsert({
    org_id: orgId,
    enabled: input.enabled,
    gmail_label: input.gmailLabel.trim(),
    match_from: input.matchFrom?.trim() || null,
    match_subject_prefix: input.matchSubjectPrefix?.trim() || null,
    services: input.services.map((s) => s.trim()).filter(Boolean),
    mailbox_member_id: input.mailboxMemberId || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Manually run the email sync now (Master Admin only). Incremental + deduped. */
export async function syncLeadsNow(): Promise<{ error?: string; result?: LeadSyncResult }> {
  const orgId = await masterGuard();
  if (!orgId) return { error: "Only the Master Admin can run the sync." };
  const result = await runLeadSync(orgId);
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  revalidatePath("/clients");
  return { result };
}

export async function saveAiKeys(input: {
  openai?: string; anthropic?: string; google?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const patch: Record<string, string> = {};
  if (input.openai?.trim()) patch.openai_key_enc = encryptSecret(input.openai.trim());
  if (input.anthropic?.trim()) patch.anthropic_key_enc = encryptSecret(input.anthropic.trim());
  if (input.google?.trim()) patch.google_key_enc = encryptSecret(input.google.trim());
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await admin.from("ai_settings").upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveFeatureModels(
  models: Partial<Record<AiFeature, FeatureModel>>,
): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { error } = await admin.from("ai_settings").upsert({ org_id: orgId, feature_models: models }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Master-Admin: set ONE role-override (role × nav module → allow/deny/default).
 *  Pass allow=null to fall back to the code default. */
export async function saveRoleOverride(input: {
  role: Role;
  navId: string;
  allow: boolean | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await masterGuard();
  if (!orgId) return { error: "Only the Master Admin can change access." };
  const admin = createAdminClient();
  if (input.allow === null) {
    await admin.from("role_overrides").delete().eq("org_id", orgId).eq("role", input.role).eq("nav_id", input.navId);
  } else {
    await admin.from("role_overrides").upsert({
      org_id: orgId, role: input.role, nav_id: input.navId, allow: input.allow,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,role,nav_id" });
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout"); // sidebar re-renders
  return { ok: true };
}

/** Master-Admin: award (or deduct, with negative points) points to a team member. */
export async function awardUserPoints(input: {
  memberId: string;
  points: number;
  reason: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  const orgId = await masterGuard();
  if (!orgId) return { error: "Only the Master Admin can award points." };
  const points = Math.trunc(input.points);
  if (!points) return { error: "Points must be a non-zero number." };
  if (!input.reason.trim()) return { error: "Add a short reason." };
  const admin = createAdminClient();
  const { error } = await admin.from("user_points").insert({
    org_id: orgId, member_id: input.memberId, points, reason: input.reason.trim(),
    awarded_by: session?.teamMember?.id ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/** Master-Admin: save the org-wide follow-up SLA windows used by the
 *  admin_tasks cron (docs/access/task overdue thresholds + the note-extension
 *  grace window). All four are clamped to >= 0 days. */
export async function saveFollowupConfig(input: {
  docsOverdueDays: number;
  accessOverdueDays: number;
  taskOverdueDays: number;
  noteExtensionDays: number;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await masterGuard();
  if (!orgId) return { error: "Only the Master Admin can change SLA windows." };
  const clamp = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
  const admin = createAdminClient();
  const { error } = await admin.from("followup_config").upsert({
    org_id: orgId,
    docs_overdue_days: clamp(input.docsOverdueDays),
    access_overdue_days: clamp(input.accessOverdueDays),
    task_overdue_days: clamp(input.taskOverdueDays),
    note_extension_days: clamp(input.noteExtensionDays),
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveIntegrations(input: {
  fathomKey?: string; pmsName?: string; pmsKey?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const patch: Record<string, unknown> = { org_id: orgId };
  if (input.fathomKey?.trim()) patch.fathom_config = { key_enc: encryptSecret(input.fathomKey.trim()) };
  if (input.fathomKey?.trim()) patch.fathom_connected = true;
  if (typeof input.pmsName === "string") patch.pms_name = input.pmsName.trim() || null;
  if (input.pmsKey?.trim()) patch.pms_key_enc = encryptSecret(input.pmsKey.trim());
  const { error } = await admin.from("integration_settings").upsert(patch, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
