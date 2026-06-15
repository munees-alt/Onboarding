import { createAdminClient } from "@/lib/supabase/admin";
import { templateById } from "@/lib/onboarding-templates";
import { PortalView, type PortalData, type IntakePrepView } from "./portal-view";

export const metadata = { title: "Finanshels — Your onboarding" };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: link } = await admin
    .from("magic_links")
    .select("client_id,run_id,expires_at")
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

  const [{ data: client }, { data: run }, { data: coa }, { data: docs }, { data: tasks }, { data: team }, { data: intake }] = await Promise.all([
    admin.from("clients").select("name,owner_name,accounting_software").eq("id", link.client_id).maybeSingle(),
    link.run_id ? admin.from("onboarding_runs").select("progress,current_stage,status,template_key").eq("id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
    link.run_id ? admin.from("coa_instances").select("accounts,client_signed_off,status,base_industry").eq("run_id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("documents").select("id,label,status").eq("client_id", link.client_id).order("created_at"),
    link.run_id ? admin.from("tasks").select("title,status,type,service").eq("run_id", link.run_id).eq("client_visible", true).order("sort") : Promise.resolve({ data: [] }),
    link.run_id ? admin.from("run_team").select("role_in_run,team_members(full_name)").eq("run_id", link.run_id) : Promise.resolve({ data: [] }),
    link.run_id ? admin.from("intake_forms").select("submitted,status,prefilled").eq("run_id", link.run_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const { data: contractRow } = link.run_id
    ? await admin.from("run_items").select("data").eq("run_id", link.run_id).eq("kind", "contract").maybeSingle()
    : { data: null };
  const contract = (contractRow?.data ?? null) as PortalData["contract"];

  const prep = (intake?.prefilled ?? null) as IntakePrepView | null;
  const intakeFields = (templateById(run?.template_key ?? "medium-team")?.intake ?? [])
    .filter((f) => f.source === "client")
    .map((f) => ({ id: f.id, label: f.label }));
  const intakeSubmitted = intake?.status === "submitted" ? (intake.submitted as Record<string, string>) : null;

  const teamMap: Record<string, string> = {};
  (team ?? []).forEach((t: { role_in_run: string; team_members: { full_name: string } | { full_name: string }[] | null }) => {
    const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
    if (tm) teamMap[t.role_in_run] = tm.full_name;
  });

  const data: PortalData = {
    token,
    clientName: client?.name ?? "Your company",
    ownerName: client?.owner_name ?? null,
    progress: run?.progress ?? 0,
    currentStage: run?.current_stage ?? 1,
    status: run?.status ?? "active",
    coa: coa ? { accounts: (coa.accounts ?? []) as NonNullable<PortalData["coa"]>["accounts"], signedOff: coa.client_signed_off, industry: coa.base_industry } : null,
    documents: (docs ?? []).map((d) => ({ id: d.id, label: d.label, status: d.status })),
    tasks: (tasks ?? []).map((t) => ({ title: t.title, status: t.status, type: t.type })),
    team: teamMap,
    intakeFields,
    intakeSubmitted,
    intakePrep: prep,
    intakeEnabled: prep ? prep.enabled !== false : intakeFields.length > 0,
    contract,
    software: client?.accounting_software ?? null,
  };

  return <PortalView data={data} />;
}
