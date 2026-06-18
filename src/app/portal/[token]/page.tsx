import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { templateById } from "@/lib/onboarding-templates";
import { PortalView, type PortalData, type IntakePrepView } from "./portal-view";
import { PortalGate } from "./portal-gate";
import { PORTAL_COOKIE, verifyPortalCookie, maskEmail } from "@/lib/portal-auth";

export const metadata = { title: "Finanshels — Your onboarding" };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: link } = await admin
    .from("magic_links")
    .select("client_id,run_id,expires_at,email")
    .eq("token", token)
    .maybeSingle();

  const expired = !link || new Date(link.expires_at).getTime() < Date.now();
  if (expired) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center", color: "var(--ink-3)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink-1)" }}>This link has expired</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Please contact your Finanshels account manager for a new link.</div>
        </div>
      </div>
    );
  }

  // Email gate: the portal only opens for the email it was sent to. Until the
  // visitor verifies a code sent to that email, show the access gate.
  const jar = await cookies();
  if (!verifyPortalCookie(token, jar.get(PORTAL_COOKIE)?.value)) {
    return <PortalGate token={token} emailHint={maskEmail(link.email)} />;
  }

  const [{ data: client }, { data: run }, { data: coa }, { data: docs }, { data: tasks }, { data: team }, { data: intake }, { data: messages }] = await Promise.all([
    admin.from("clients").select("name,owner_name,accounting_software,vat_trn,am_id,org_id").eq("id", link.client_id).maybeSingle(),
    link.run_id ? admin.from("onboarding_runs").select("progress,current_stage,status,template_key").eq("id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
    link.run_id ? admin.from("coa_instances").select("accounts,client_signed_off,status,base_industry").eq("run_id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("documents").select("id,label,status,review_note").eq("client_id", link.client_id).order("created_at"),
    link.run_id ? admin.from("tasks").select("title,status,type,service,board_column,owner_kind").eq("run_id", link.run_id).eq("client_visible", true).order("sort") : Promise.resolve({ data: [] }),
    link.run_id ? admin.from("run_team").select("role_in_run,team_members(full_name,email)").eq("run_id", link.run_id) : Promise.resolve({ data: [] }),
    link.run_id ? admin.from("intake_forms").select("submitted,status,prefilled").eq("run_id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
    link.run_id ? admin.from("run_messages").select("author_name,author_role,body,created_at,task_ref").eq("run_id", link.run_id).order("created_at") : Promise.resolve({ data: [] }),
  ]);

  const [{ data: contractRow }, { data: signoffRow }, { data: colsRow }] = link.run_id
    ? await Promise.all([
        admin.from("run_items").select("data").eq("run_id", link.run_id).eq("kind", "contract").maybeSingle(),
        admin.from("run_items").select("data").eq("run_id", link.run_id).eq("kind", "signoff").maybeSingle(),
        admin.from("run_items").select("data").eq("run_id", link.run_id).eq("kind", "board_columns").maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const contract = (contractRow?.data ?? null) as PortalData["contract"];
  const signedOff = !!(signoffRow?.data as { signed?: boolean } | null)?.signed;
  const boardCols = (colsRow?.data as { columns?: string[] } | null)?.columns ?? null;

  const prep = (intake?.prefilled ?? null) as IntakePrepView | null;
  const intakeFields = (templateById(run?.template_key ?? "medium-team")?.intake ?? [])
    .filter((f) => f.source === "client")
    .map((f) => ({ id: f.id, label: f.label }));
  const intakeSubmitted = intake?.status === "submitted" ? (intake.submitted as Record<string, string>) : null;

  const teamMap: Record<string, string> = {};
  const emailMap: Record<string, string> = {};
  (team ?? []).forEach((t: { role_in_run: string; team_members: { full_name: string; email: string | null } | { full_name: string; email: string | null }[] | null }) => {
    const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
    if (tm) { teamMap[t.role_in_run] = tm.full_name; if (tm.email) emailMap[t.role_in_run] = tm.email; }
  });

  // Account Manager is authoritatively the AM chosen when the client was created
  // (clients.am_id) — not whoever triggered the run.
  if (client?.am_id) {
    const { data: am } = await admin.from("team_members").select("full_name,email").eq("id", client.am_id).maybeSingle();
    if (am) { teamMap.am = am.full_name; if (am.email) emailMap.am = am.email; }
  }
  // Onboarding Partner = Munees, default for all clients.
  let onboardingPartner = teamMap.onboarding_partner ?? null;
  if (!onboardingPartner && client?.org_id) {
    const { data: p } = await admin.from("team_members").select("full_name").eq("org_id", client.org_id).ilike("full_name", "munees%").eq("active", true).limit(1).maybeSingle();
    onboardingPartner = p?.full_name ?? "Munees KV";
  }
  // Customer Success Manager (escalation second line) — resolved from the org chart.
  let csm: { name: string; email: string | null } | null = null;
  if (client?.org_id) {
    const { data: c } = await admin.from("team_members").select("full_name,email").eq("org_id", client.org_id).ilike("title", "%customer success%").eq("active", true).limit(1).maybeSingle();
    if (c) csm = { name: c.full_name, email: c.email ?? null };
  }

  const data: PortalData = {
    token,
    clientName: client?.name ?? "Your company",
    ownerName: client?.owner_name ?? null,
    trn: client?.vat_trn ?? null,
    progress: run?.progress ?? 0,
    currentStage: run?.current_stage ?? 1,
    status: run?.status ?? "active",
    coa: coa ? { accounts: (coa.accounts ?? []) as NonNullable<PortalData["coa"]>["accounts"], signedOff: coa.client_signed_off, industry: coa.base_industry } : null,
    documents: (docs ?? []).map((d) => ({ id: d.id, label: d.label, status: d.status, reviewNote: (d as { review_note?: string | null }).review_note ?? null })),
    tasks: (tasks ?? []).map((t) => ({ title: t.title, status: t.status, type: t.type, boardColumn: t.board_column ?? null, due: (t as { service?: string | null }).service ?? null, ownerKind: (t as { owner_kind?: string }).owner_kind ?? "team" })),
    boardColumns: boardCols,
    team: teamMap,
    teamEmail: emailMap,
    messages: (messages ?? []).map((m) => ({ author: m.author_name ?? "Team", role: m.author_role ?? "", body: m.body, at: m.created_at, taskRef: (m as { task_ref?: string | null }).task_ref ?? null })),
    signedOff,
    intakeFields,
    intakeSubmitted,
    intakePrep: prep,
    intakeEnabled: prep ? prep.enabled !== false : intakeFields.length > 0,
    contract,
    software: client?.accounting_software ?? null,
    onboardingPartner,
    csm,
  };

  return <PortalView data={data} />;
}
