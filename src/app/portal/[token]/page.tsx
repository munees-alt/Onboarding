import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { templateById } from "@/lib/onboarding-templates";
import { PortalView, type PortalData, type IntakePrepView } from "./portal-view";
import { PortalGate } from "./portal-gate";
import { PORTAL_COOKIE, verifyPortalCookie, maskEmail } from "@/lib/portal-auth";

export const metadata = { title: "Finanshels — Your onboarding" };

export default async function PortalPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ entity?: string }>;
}) {
  const { token } = await params;
  const { entity: entityFromUrl } = await searchParams;
  const admin = createAdminClient();

  const { data: link } = await admin
    .from("magic_links")
    .select("client_id,run_id,group_id,expires_at,email,alt_emails")
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

  // Group-aware entity resolution. If this magic link belongs to a client_group,
  // pull every sibling run + present a switcher in the portal. The active
  // entity is decided by ?entity=<runId>, defaulting to the link's own run.
  type Sibling = { runId: string; clientId: string; clientName: string; progress: number };
  let siblings: Sibling[] = [];
  let groupName: string | null = null;
  let activeRunId: string | null = link.run_id;
  let activeClientId: string | null = link.client_id;
  if (link.group_id) {
    const [{ data: gRow }, { data: gRuns }] = await Promise.all([
      admin.from("client_groups").select("name").eq("id", link.group_id).maybeSingle(),
      admin.from("onboarding_runs").select("id,client_id,progress,clients(name)").eq("group_id", link.group_id).order("created_at"),
    ]);
    groupName = (gRow?.name as string | null) ?? null;
    siblings = (gRuns ?? []).map((r) => {
      const cl = Array.isArray((r as { clients?: { name?: string } | { name?: string }[] }).clients)
        ? ((r as { clients: { name?: string }[] }).clients[0])
        : ((r as { clients?: { name?: string } }).clients);
      return {
        runId: r.id as string,
        clientId: r.client_id as string,
        clientName: (cl?.name as string | undefined) ?? "Company",
        progress: (r.progress as number | undefined) ?? 0,
      };
    });
    if (entityFromUrl && siblings.some((s) => s.runId === entityFromUrl)) {
      const pick = siblings.find((s) => s.runId === entityFromUrl);
      if (pick) { activeRunId = pick.runId; activeClientId = pick.clientId; }
    }
  }

  const [{ data: client }, { data: run }, { data: coa }, { data: docs }, { data: tasks }, { data: team }, { data: intake }, { data: messages }] = await Promise.all([
    admin.from("clients").select("name,owner_name,accounting_software,vat_trn,am_id,org_id").eq("id", activeClientId).maybeSingle(),
    activeRunId ? admin.from("onboarding_runs").select("progress,current_stage,status,template_key").eq("id", activeRunId).maybeSingle() : Promise.resolve({ data: null }),
    activeRunId ? admin.from("coa_instances").select("accounts,client_signed_off,status,base_industry").eq("run_id", activeRunId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("documents").select("id,label,status,review_note,received_outside_portal,received_note").eq("client_id", activeClientId).order("created_at"),
    activeRunId ? admin.from("tasks").select("title,status,type,service,board_column,owner_kind").eq("run_id", activeRunId).eq("client_visible", true).order("sort") : Promise.resolve({ data: [] }),
    activeRunId ? admin.from("run_team").select("role_in_run,team_members(full_name,email)").eq("run_id", activeRunId) : Promise.resolve({ data: [] }),
    activeRunId ? admin.from("intake_forms").select("submitted,status,prefilled").eq("run_id", activeRunId).maybeSingle() : Promise.resolve({ data: null }),
    activeRunId ? admin.from("run_messages").select("author_name,author_role,body,created_at,task_ref").eq("run_id", activeRunId).order("created_at") : Promise.resolve({ data: [] }),
  ]);

  const [{ data: contractRow }, { data: signoffRow }, { data: colsRow }] = activeRunId
    ? await Promise.all([
        admin.from("run_items").select("data").eq("run_id", activeRunId).eq("kind", "contract").maybeSingle(),
        admin.from("run_items").select("data").eq("run_id", activeRunId).eq("kind", "signoff").maybeSingle(),
        admin.from("run_items").select("data").eq("run_id", activeRunId).eq("kind", "board_columns").maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const contract = (contractRow?.data ?? null) as PortalData["contract"];
  const signedOff = !!(signoffRow?.data as { signed?: boolean } | null)?.signed;
  const boardCols = (colsRow?.data as { columns?: string[] } | null)?.columns ?? null;

  const { data: driveRow } = await admin.from("drive_folders").select("tree").eq("client_id", activeClientId).maybeSingle();
  const driveLink = (driveRow?.tree as { link?: string } | null)?.link ?? null;

  const { data: accessRows } = activeRunId
    ? await admin.from("run_items").select("id,data,status").eq("run_id", activeRunId).eq("kind", "access").order("sort")
    : { data: [] as { id: string; data: Record<string, unknown>; status: string }[] };
  const access = (accessRows ?? []).map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const items = Array.isArray((d as { items?: unknown[] }).items) ? ((d as { items: Array<Record<string, unknown>> }).items) : [];
    const itemWithReceipt = items.find((it) => it.receivedOutsidePortal);
    const receivedOutsidePortal = !!(itemWithReceipt || d.receivedOutsidePortal);
    const receivedNote = (itemWithReceipt?.receivedNote ?? d.receivedNote ?? null) as string | null;
    return {
      rowId: r.id, label: String(d.label ?? "Access"), method: String(d.method ?? ""),
      email: String(d.email ?? ""), sop: Array.isArray(d.sop) ? (d.sop as unknown[]).map(String) : [],
      systemName: d.systemName ? String(d.systemName) : undefined,
      status: String(d.status ?? r.status ?? "requested"), note: d.note ? String(d.note) : undefined,
      accessMode: (d.accessMode === "credentials" ? "credentials" : "viewer") as "viewer" | "credentials",
      // Security: once saved, the client cannot view the login back — we send neither the
      // password nor the username, only whether something is on file.
      credSaved: !!d.credPasswordEnc,
      receivedOutsidePortal,
      receivedNote,
    };
  });

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
    documents: (docs ?? []).map((d) => ({
      id: d.id, label: d.label, status: d.status,
      reviewNote: (d as { review_note?: string | null }).review_note ?? null,
      receivedOutsidePortal: !!(d as { received_outside_portal?: boolean }).received_outside_portal,
      receivedNote: (d as { received_note?: string | null }).received_note ?? null,
    })),
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
    access,
    driveLink,
    clientEmail: link.email ?? null,
    altEmails: (link.alt_emails ?? []) as string[],
    templateKey: (run?.template_key as string | null) ?? null,
    group: link.group_id
      ? {
          id: link.group_id as string,
          name: groupName ?? "Group",
          activeRunId: activeRunId ?? "",
          entities: siblings.map((s) => ({ runId: s.runId, clientName: s.clientName, progress: s.progress })),
        }
      : null,
  };

  return <PortalView data={data} />;
}
