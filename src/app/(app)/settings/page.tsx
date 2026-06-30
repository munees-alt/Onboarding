import { requireSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessMatrix, ACCESS_ROLES } from "@/lib/role-access";
import { getAmCapacityList, findTaxHead, findTaxTeamLead } from "@/lib/capacity";
import { SettingsForm } from "./settings-form";
import { TaxCapacityCard } from "./tax-capacity-card";
import { TaskPendingSlaCard } from "./task-pending-sla-card";
import type { AiFeature, FeatureModel } from "@/lib/ai-config";

export default async function SettingsPage() {
  const s = await requireSession();
  if (!canOpenSettings(s.profile.role))
    return <Restricted message="Settings are only available to the Master Admin and Ops Head." />;

  const admin = createAdminClient();
  const isAdmin = (s.teamMember?.role ?? s.profile.role) === "admin";
  const [
    { data: ai },
    { data: intg },
    { data: gconn },
    { data: slackOrgRows },
    { data: leadCfg },
    { data: mailboxRows },
    accessMatrix,
    { data: teamRows },
    { data: pointsRows },
  ] = await Promise.all([
    admin.from("ai_settings").select("openai_key_enc,anthropic_key_enc,google_key_enc,feature_models").eq("org_id", s.profile.org_id).maybeSingle(),
    admin.from("integration_settings").select("fathom_connected,pms_name,pms_key_enc").eq("org_id", s.profile.org_id).maybeSingle(),
    s.profile.team_member_id
      ? admin.from("member_connections").select("provider,account_email,connected").eq("team_member_id", s.profile.team_member_id).in("provider", ["google", "zoho"])
      : Promise.resolve({ data: [] }),
    admin.from("member_connections").select("config,connected,team_member_id").eq("provider", "slack").eq("org_id", s.profile.org_id).eq("connected", true).order("updated_at", { ascending: false }).limit(1),
    admin.from("lead_sync_config").select("*").eq("org_id", s.profile.org_id).maybeSingle(),
    admin.from("member_connections").select("team_member_id, account_email, team_members(full_name)").eq("org_id", s.profile.org_id).eq("provider", "google").eq("connected", true),
    isAdmin && s.profile.org_id ? getAccessMatrix(s.profile.org_id) : Promise.resolve(null),
    isAdmin
      ? admin.from("team_members").select("id,full_name,role,title").eq("org_id", s.profile.org_id).eq("active", true).order("full_name")
      : Promise.resolve({ data: [] }),
    isAdmin
      ? admin.from("user_points").select("member_id, points, reason, created_at").eq("org_id", s.profile.org_id).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  const [{ data: orgRow }, { data: fuRow }] = await Promise.all([
    admin.from("orgs").select("feedback_form_url,tax_capacity_default,tax_default_assignee_id").eq("id", s.profile.org_id).maybeSingle(),
    admin.from("followup_config").select("docs_overdue_days,access_overdue_days,task_overdue_days,note_extension_days,task_pending_sla_days,compliance_reminder_days,team_escalation_days").eq("org_id", s.profile.org_id).maybeSingle(),
  ]);
  const conns = (gconn ?? []) as { provider: string; account_email: string | null; connected: boolean }[];
  const google = conns.find((c) => c.provider === "google");
  const zoho = conns.find((c) => c.provider === "zoho");
  const slackOrgRow = (slackOrgRows ?? [])[0] as { config?: { team_name?: string } } | undefined;
  const slackWorkspace = slackOrgRow?.config?.team_name ?? null;

  type MbRow = { team_member_id: string; account_email: string | null; team_members: { full_name?: string } | { full_name?: string }[] | null };
  const mailboxes = ((mailboxRows ?? []) as MbRow[]).map((m) => {
    const tm = Array.isArray(m.team_members) ? m.team_members[0] : m.team_members;
    return { id: m.team_member_id, label: `${tm?.full_name ?? "Member"}${m.account_email ? ` · ${m.account_email}` : ""}` };
  });

  const lead = {
    enabled: leadCfg?.enabled ?? true,
    gmailLabel: leadCfg?.gmail_label ?? "Cadence Onboarding",
    matchFrom: leadCfg?.match_from ?? "",
    matchSubjectPrefix: leadCfg?.match_subject_prefix ?? "",
    services: Array.isArray(leadCfg?.services) ? (leadCfg!.services as string[]) : ["Accounting & Bookkeeping", "Prior-Period Catch-Up & Books Cleanup"],
    mailboxMemberId: leadCfg?.mailbox_member_id ?? "",
    lastSyncedAt: leadCfg?.last_synced_at ?? null,
    lastResult: (leadCfg?.last_result ?? null) as { scanned: number; created: number; at: string } | null,
  };

  // Aggregate points per member for the leaderboard.
  type PointRow = { member_id: string; points: number; reason: string; created_at: string };
  const points = (pointsRows ?? []) as PointRow[];
  const totals: Record<string, number> = {};
  for (const p of points) totals[p.member_id] = (totals[p.member_id] ?? 0) + p.points;

  const team = ((teamRows ?? []) as { id: string; full_name: string; role: string; title: string | null }[]).map((t) => ({
    id: t.id, name: t.full_name, role: t.role, title: t.title, points: totals[t.id] ?? 0,
  })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const capacityRows = s.profile.org_id ? await getAmCapacityList(s.profile.org_id) : [];
  const taxHead = s.profile.org_id ? await findTaxHead(s.profile.org_id) : null;
  const taxLead = s.profile.org_id ? await findTaxTeamLead(s.profile.org_id, taxHead?.id ?? null) : null;

  return (
    <div className="scroll">
      <div className="page">
        <TaskPendingSlaCard
          taskPendingSLADays={(fuRow?.task_pending_sla_days as number | null) ?? 3}
          docsOverdueDays={fuRow?.docs_overdue_days ?? 2}
          accessOverdueDays={fuRow?.access_overdue_days ?? 2}
          taskOverdueDays={fuRow?.task_overdue_days ?? 0}
          noteExtensionDays={fuRow?.note_extension_days ?? 2}
          complianceReminderDays={(fuRow?.compliance_reminder_days as number | null) ?? 30}
          teamEscalationDays={(fuRow?.team_escalation_days as number | null) ?? 2}
        />
        <TaxCapacityCard
          headName={taxHead?.name ?? null}
          leadName={taxLead?.name ?? null}
          taxCapacityDefault={(orgRow?.tax_capacity_default as number | null) ?? 60}
          rows={capacityRows.map((r) => ({ id: r.id, name: r.name, role: r.role, title: r.title, isHead: r.isHead, isLead: r.isLead, isExtra: r.isExtra, maxTasks: r.maxTasks, currentLoad: r.currentLoad, autoLoad: r.autoLoad, loadOverride: r.loadOverride }))}
        />
        <SettingsForm
          keysSet={{ openai: !!ai?.openai_key_enc, anthropic: !!ai?.anthropic_key_enc, google: !!ai?.google_key_enc }}
          models={(ai?.feature_models ?? {}) as Partial<Record<AiFeature, FeatureModel>>}
          fathomSet={!!intg?.fathom_connected}
          pmsName={intg?.pms_name ?? ""}
          pmsSet={!!intg?.pms_key_enc}
          googleEmail={google?.connected ? google.account_email ?? null : null}
          zohoConnected={!!zoho?.connected}
          slackWorkspace={slackWorkspace}
          isAdmin={isAdmin}
          lead={lead}
          mailboxes={mailboxes}
          accessMatrix={accessMatrix}
          accessRoles={ACCESS_ROLES}
          team={team}
          recentPoints={points.slice(0, 20)}
          followup={{
            docsOverdueDays: fuRow?.docs_overdue_days ?? 2,
            accessOverdueDays: fuRow?.access_overdue_days ?? 2,
            taskOverdueDays: fuRow?.task_overdue_days ?? 0,
            noteExtensionDays: fuRow?.note_extension_days ?? 2,
          }}
          feedbackFormUrl={(orgRow?.feedback_form_url as string | null) ?? null}
          taxDefaultAssigneeId={(orgRow?.tax_default_assignee_id as string | null) ?? null}
        />
      </div>
    </div>
  );
}
