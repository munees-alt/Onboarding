"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TaxStatus = "open_item" | "pending" | "awaiting" | "application_submitted" | "completed";
export type TaxService = "ct_reg" | "vat_reg" | "ct_fil" | "vat_fil";
export type AwaitingTag = "fta_dependency" | "team_dependency" | "task_dependency" | "client_dependency";

const VALID_STATUSES: TaxStatus[] = ["open_item", "pending", "awaiting", "application_submitted", "completed"];
const VALID_SERVICES: TaxService[] = ["ct_reg", "vat_reg", "ct_fil", "vat_fil"];
const VALID_TAGS: AwaitingTag[] = ["fta_dependency", "team_dependency", "task_dependency", "client_dependency"];

export type TaxClientRow = {
  clientId: string;
  clientName: string;
  status: TaxStatus;
  services: TaxService[];
  awaitingTag: AwaitingTag | null;
  notes: string | null;
  driveLink: string | null;
  referenceLink: string | null;
  assignedTo: string[];
  assignedToNames: string[];
  completedAt: string | null;
  runId: string | null;
  teamMembers: { role: string; name: string; email: string | null }[];
};

export type TaxTeamMember = { id: string; name: string; role: string; title: string | null };

const ROLE_LABEL: Record<string, string> = {
  am: "AM",
  team_lead: "Team Lead",
  senior: "Senior",
  junior: "Junior",
  associate: "Associate",
  intern: "Intern",
  ops_head: "Ops",
  admin: "Admin",
};

async function getTaxTeam(orgId: string): Promise<{ taxHeadId: string | null; taxLeadId: string | null; team: TaxTeamMember[] }> {
  const admin = createAdminClient();
  const { data: all } = await admin
    .from("team_members")
    .select("id,full_name,role,title,reports_to")
    .eq("org_id", orgId)
    .eq("active", true);
  const members = (all ?? []) as { id: string; full_name: string; role: string; title: string | null; reports_to: string | null }[];

  // Find Gautam (Tax Head — title contains "Tax Team" head) and Nafila (External Tax lead)
  const taxHead = members.find((m) => /head.*tax/i.test(m.title ?? "")) ?? null;
  const taxLead = members.find((m) => /team lead.*tax|tax.*team lead|external tax/i.test(m.title ?? "")) ?? null;

  // Build the subtree under Gautam (Tax Head)
  const teamIds = new Set<string>();
  if (taxHead) {
    teamIds.add(taxHead.id);
    const q = [taxHead.id];
    while (q.length) {
      const p = q.shift()!;
      for (const m of members) if (m.reports_to === p && !teamIds.has(m.id)) { teamIds.add(m.id); q.push(m.id); }
    }
  }
  // Also include anyone whose title contains "Tax" (catches anyone outside Gautam's subtree)
  for (const m of members) {
    if (/tax/i.test(m.title ?? "")) teamIds.add(m.id);
  }

  const team: TaxTeamMember[] = [...teamIds].map((id) => {
    const m = members.find((x) => x.id === id)!;
    return { id, name: m.full_name, role: m.role, title: m.title };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    taxHeadId: taxHead?.id ?? null,
    taxLeadId: taxLead?.id ?? null,
    team,
  };
}

export async function getTaxComplianceClients(): Promise<{
  error?: string;
  clients: TaxClientRow[];
  taxTeam: TaxTeamMember[];
  taxHeadId: string | null;
  taxLeadId: string | null;
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in.", clients: [], taxTeam: [], taxHeadId: null, taxLeadId: null };
  const admin = createAdminClient();
  const orgId = session.profile.org_id;

  const [{ data: rows }, taxTeam] = await Promise.all([
    admin.from("tax_compliance_records").select("*").eq("org_id", orgId),
    getTaxTeam(orgId),
  ]);

  if (!rows?.length) {
    return { clients: [], taxTeam: taxTeam.team, taxHeadId: taxTeam.taxHeadId, taxLeadId: taxTeam.taxLeadId };
  }

  const clientIds = rows.map((r) => r.client_id as string);

  const [{ data: clientRows }, { data: drive }, { data: runsRows }, { data: allMembers }] = await Promise.all([
    admin.from("clients").select("id,name,am_id").in("id", clientIds),
    admin.from("drive_folders").select("client_id,tree").in("client_id", clientIds),
    admin.from("onboarding_runs").select("id,client_id,am_id,status").in("client_id", clientIds),
    admin.from("team_members").select("id,full_name,email,role,title").eq("org_id", orgId).eq("active", true),
  ]);

  const membersById = new Map((allMembers ?? []).map((m) => [m.id as string, m as { id: string; full_name: string; email: string | null; role: string; title: string | null }]));
  const driveByClient = new Map((drive ?? []).map((d) => [d.client_id as string, ((d.tree as { link?: string } | null)?.link) ?? null]));
  const runByClient = new Map<string, { id: string; am_id: string | null }>();
  for (const r of runsRows ?? []) {
    if (r.status === "complete" || r.status === "closed") continue;
    if (!runByClient.has(r.client_id as string)) runByClient.set(r.client_id as string, { id: r.id as string, am_id: r.am_id as string | null });
  }

  // For each run, pull run_team
  const runIds = [...runByClient.values()].map((r) => r.id);
  const teamByRun = new Map<string, { team_member_id: string; role: string }[]>();
  if (runIds.length) {
    const { data: rt } = await admin.from("run_team").select("run_id,team_member_id,role").in("run_id", runIds);
    for (const r of rt ?? []) {
      const list = teamByRun.get(r.run_id as string) ?? [];
      list.push({ team_member_id: r.team_member_id as string, role: r.role as string });
      teamByRun.set(r.run_id as string, list);
    }
  }

  const rowsByClient = new Map(rows.map((r) => [r.client_id as string, r]));

  const clients: TaxClientRow[] = (clientRows ?? []).map((c) => {
    const r = rowsByClient.get(c.id as string)!;
    const run = runByClient.get(c.id as string) ?? null;

    // Build the onboarding team: AM + run_team members
    const teamMap = new Map<string, { role: string; name: string; email: string | null }>();
    const amId = (c.am_id as string | null) ?? run?.am_id ?? null;
    if (amId) {
      const m = membersById.get(amId);
      if (m) teamMap.set(m.id, { role: "AM", name: m.full_name, email: m.email });
    }
    if (run) {
      for (const rt of teamByRun.get(run.id) ?? []) {
        if (teamMap.has(rt.team_member_id)) continue;
        const m = membersById.get(rt.team_member_id);
        if (m) teamMap.set(m.id, { role: ROLE_LABEL[rt.role] ?? rt.role, name: m.full_name, email: m.email });
      }
    }

    const assigned: string[] = (r.assigned_to as string[] | null) ?? [];

    return {
      clientId: c.id as string,
      clientName: c.name as string,
      status: (r.status as TaxStatus) ?? "open_item",
      services: ((r.services as string[] | null) ?? []) as TaxService[],
      awaitingTag: (r.awaiting_tag as AwaitingTag | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      driveLink: driveByClient.get(c.id as string) ?? null,
      referenceLink: (r.reference_link as string | null) ?? null,
      assignedTo: assigned,
      assignedToNames: assigned.map((id) => membersById.get(id)?.full_name ?? id),
      completedAt: (r.completed_at as string | null) ?? null,
      runId: run?.id ?? null,
      teamMembers: [...teamMap.values()],
    };
  });

  return {
    clients,
    taxTeam: taxTeam.team,
    taxHeadId: taxTeam.taxHeadId,
    taxLeadId: taxTeam.taxLeadId,
  };
}

export async function saveTaxComplianceRecord(input: {
  clientId: string;
  status: TaxStatus;
  services: TaxService[];
  awaitingTag: AwaitingTag | null;
  notes: string | null;
  referenceLink: string | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!VALID_STATUSES.includes(input.status)) return { error: "Invalid status." };
  const services = (input.services ?? []).filter((s) => VALID_SERVICES.includes(s));
  const awaitingTag = input.awaitingTag && VALID_TAGS.includes(input.awaitingTag) ? input.awaitingTag : null;

  const supabase = await createClient();
  const { error } = await supabase.from("tax_compliance_records").upsert(
    {
      org_id: session.profile.org_id,
      client_id: input.clientId,
      status: input.status,
      services,
      awaiting_tag: input.status === "awaiting" ? awaitingTag : null,
      notes: input.notes || null,
      reference_link: input.referenceLink || null,
      completed_by: input.status === "completed" ? (session.teamMember?.full_name ?? null) : null,
      completed_at: input.status === "completed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/tax-compliance");
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true };
}

export async function assignTaxMembers(clientId: string, memberIds: string[]): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  // Upsert the record with the new assignees (preserve existing fields)
  const { error: upsertErr } = await admin
    .from("tax_compliance_records")
    .upsert(
      {
        org_id: session.profile.org_id,
        client_id: clientId,
        assigned_to: memberIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (upsertErr) return { error: upsertErr.message };

  // Action-item chip for each assignee
  if (memberIds.length) {
    await supabase.from("admin_tasks").insert(
      memberIds.map((memberId) => ({
        org_id: session.profile.org_id,
        owner_id: memberId,
        kind: "tax_compliance_assignment",
        client_id: clientId,
        title: `Tax compliance assigned — ${client.name}`,
        body: `You have been assigned to the tax compliance card for ${client.name}. Open Tax Compliance to view services, status and notes.`,
      })),
    );
  }

  revalidatePath("/tax-compliance");
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Sends a free-text note to all assigned tax team members as an admin_tasks action item.
 * Used when the onboarding/AM team needs the tax team to do something specific.
 */
export async function requestToTaxTeam(clientId: string, note: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { error: "Note required." };
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  const { data: rec } = await admin
    .from("tax_compliance_records")
    .select("assigned_to")
    .eq("org_id", session.profile.org_id)
    .eq("client_id", clientId)
    .maybeSingle();

  let assignees: string[] = (rec?.assigned_to as string[] | null) ?? [];
  if (!assignees.length) {
    // Fall back to Gautam (Tax Head) + Nafila (Tax Team Lead)
    const team = await getTaxTeam(session.profile.org_id);
    assignees = [team.taxHeadId, team.taxLeadId].filter((x): x is string => !!x);
  }
  if (!assignees.length) return { error: "No tax team assignees found." };

  const requester = session.teamMember?.full_name ?? "Onboarding team";
  await supabase.from("admin_tasks").insert(
    assignees.map((memberId) => ({
      org_id: session.profile.org_id,
      owner_id: memberId,
      kind: "tax_compliance_request",
      client_id: clientId,
      title: `Tax request — ${client.name}`,
      body: `${requester} requested: ${trimmed}`,
    })),
  );

  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Creates / promotes a tax compliance record for a client.
 * Called from the onboarding urgent-compliance step when an item is tax-related.
 * Pre-assigns Gautam (Tax Head) + Nafila (Tax Team Lead) and notifies both.
 */
export async function escalateToTaxCompliance(input: {
  clientId: string;
  services: TaxService[];
  notes: string | null;
  sourceRunId?: string | null;
  sourceStepId?: string | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: client } = await supabase.from("clients").select("name").eq("id", input.clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  const team = await getTaxTeam(session.profile.org_id);
  const defaults = [team.taxHeadId, team.taxLeadId].filter((x): x is string => !!x);
  const services = (input.services ?? []).filter((s) => VALID_SERVICES.includes(s));

  const { error } = await admin.from("tax_compliance_records").upsert(
    {
      org_id: session.profile.org_id,
      client_id: input.clientId,
      status: "open_item",
      services,
      notes: input.notes || null,
      assigned_to: defaults,
      created_by: session.teamMember?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) return { error: error.message };

  // Action-item chip on each of (Gautam, Nafila)
  if (defaults.length) {
    const serviceList = services.length ? services.map((s) => SERVICE_LABEL[s]).join(", ") : "unspecified";
    await supabase.from("admin_tasks").insert(
      defaults.map((memberId) => ({
        org_id: session.profile.org_id,
        owner_id: memberId,
        kind: "tax_compliance_new",
        client_id: input.clientId,
        run_id: input.sourceRunId ?? null,
        step_id: input.sourceStepId ?? null,
        title: `New tax compliance item — ${client.name}`,
        body: `Services needed: ${serviceList}. ${input.notes ? `Notes: ${input.notes}` : ""}\nAssign a team member and update the card on Tax Compliance.`,
      })),
    );
  }

  revalidatePath("/tax-compliance");
  revalidatePath("/my-work");
  return { ok: true };
}

const SERVICE_LABEL: Record<TaxService, string> = {
  ct_reg: "CT Registration",
  vat_reg: "VAT Registration",
  ct_fil: "CT Filing",
  vat_fil: "VAT Filing",
};
