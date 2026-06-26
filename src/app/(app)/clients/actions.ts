"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { createRunFromTemplate } from "@/lib/runs";
import { createClientDriveFolder, getDriveCapableMemberId } from "@/lib/google";
import { runAi } from "@/lib/ai";
import { fetchFathomNotes, listFathomMeetings, fathomMeetingNotes, fathomMeetingEmails } from "@/lib/fathom";
import type { SessionInfo } from "@/lib/types";
import { isMasterAdmin } from "@/lib/roles";
import { buildClientCode } from "@/lib/client-code";
import { sendGmailAs } from "@/lib/google";
import {
  INTAKE_EMAIL_SUBJECT,
  renderIntakeEmail,
  renderIntakeWhatsapp,
} from "@/lib/welcome-email";

/** Client-playbook edits are Master-Admin-only; everyone else has view access. */
function masterAdminGate(session: SessionInfo | null): { error?: string } {
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!isMasterAdmin(role)) return { error: "Only a Master Admin can edit the client playbook." };
  return {};
}

/**
 * Turns a call's notes (+ recording link) into playbook insights: a brief business
 * description (in the client's own words) and the pain points raised. Updates the client.
 */
export interface InsightSection { heading: string; body: string }

/**
 * Build + email a weekly client digest: open tasks, upcoming compliance, doc
 * status, access status, AI-drafted intro. Sent via the run AM's connected
 * Gmail (or any Google-connected member) to the client's primary contact +
 * portal alt emails. Manual trigger (no cron — per user direction).
 */
export async function sendClientWeeklyDigest(clientId: string): Promise<{ error?: string; ok?: boolean; sentTo?: string[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "senior", "ops_head", "admin"].includes(role))
    return { error: "Only AM / TL / Senior or admin can send the weekly digest." };
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name,primary_contact_email,owner_name,am_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found." };

  // Latest active run for this client (for tasks + compliance).
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("id,target_completion,current_stage,progress,status")
    .eq("client_id", clientId)
    .not("status", "in", "(archived,closed,complete)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tasks = run
    ? (await supabase.from("tasks").select("title,status,due_date,owner_kind,notes").eq("run_id", run.id)).data ?? []
    : [];
  const openTasks = tasks.filter((t) => t.status !== "complete");
  const clientTasks = openTasks.filter((t) => t.owner_kind === "client");

  const compliance = run
    ? (await supabase.from("run_items").select("data").eq("run_id", run.id).eq("kind", "compliance")).data ?? []
    : [];

  const docs = (await supabase.from("documents").select("label,status,received_at").eq("client_id", clientId)).data ?? [];
  const docsPending = docs.filter((d) => d.status !== "uploaded");

  const access = run
    ? (await supabase.from("run_items").select("data").eq("run_id", run.id).eq("kind", "access")).data ?? []
    : [];
  const accessPending = access.filter((a) => {
    const d = a.data as { status?: string };
    return d?.status !== "granted";
  });

  // Recipients = primary email + alt emails from the portal magic link (if any).
  const recipients: string[] = [];
  if (client.primary_contact_email) recipients.push(client.primary_contact_email);
  const { data: linkRow } = await supabase
    .from("magic_links")
    .select("alt_emails")
    .eq("client_id", clientId)
    .eq("purpose", "portal")
    .maybeSingle();
  if (Array.isArray(linkRow?.alt_emails)) recipients.push(...(linkRow!.alt_emails as string[]));
  const recipientList = [...new Set(recipients.filter(Boolean))];
  if (!recipientList.length) return { error: "No recipient email — set the client's primary contact email first." };

  // Plain-text body (AI-polished intro + factual sections).
  const intro = await runAi(session.profile.org_id, "welcome_email", {
    system: "You write the warm 1-paragraph intro of a weekly client status email from a UAE accounting firm. Output ONLY plain text — no markdown, no asterisks, no greeting line ('Dear X'), no sign-off. 2-3 sentences.",
    prompt: `Write the intro paragraph of this client's Monday digest. Client name: ${client.name}. Contact: ${client.owner_name ?? ""}. Mention that the team is on track / actively working, and tell them what they'll see below (open tasks, pending docs, anything we need from them). Tone: warm, professional, brief.`,
  }).catch(() => "");

  const lines: string[] = [];
  lines.push(`Dear ${client.owner_name ?? client.name},`);
  lines.push("");
  lines.push(intro.trim() || `Here's your weekly update from Finanshels for ${client.name}.`);
  lines.push("");
  if (clientTasks.length) {
    lines.push("TASKS WE NEED FROM YOU");
    for (const t of clientTasks) {
      const due = t.due_date ? ` · due ${t.due_date}` : "";
      lines.push(`- ${t.title}${due}`);
    }
    lines.push("");
  }
  if (docsPending.length) {
    lines.push("DOCUMENTS STILL PENDING");
    for (const d of docsPending) lines.push(`- ${d.label}`);
    lines.push("");
  }
  if (accessPending.length) {
    lines.push("SYSTEM ACCESS WE'RE WAITING ON");
    for (const a of accessPending) {
      const d = a.data as { label?: string };
      lines.push(`- ${d?.label ?? "Access"}`);
    }
    lines.push("");
  }
  if (compliance.length) {
    lines.push("UPCOMING COMPLIANCE");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = compliance
      .map((r) => r.data as { label?: string; date?: string })
      .filter((i) => i?.date)
      .map((i) => ({ ...i, daysAway: Math.round((new Date(i.date!).getTime() - today.getTime()) / 86_400_000) }))
      .filter((i) => i.daysAway >= 0 && i.daysAway <= 60)
      .sort((a, b) => a.daysAway - b.daysAway);
    for (const i of items) lines.push(`- ${i.label} — ${i.date} (${i.daysAway}d away)`);
    if (!items.length) lines.push("- All compliance items are over 60 days away or have no firm date yet.");
    lines.push("");
  }
  if (run) {
    lines.push("ONBOARDING PROGRESS");
    lines.push(`- We are on stage ${run.current_stage}, currently ${run.progress}% complete.`);
    if (run.target_completion) lines.push(`- Target go-live: ${run.target_completion}.`);
    lines.push("");
  }
  if (!clientTasks.length && !docsPending.length && !accessPending.length) {
    lines.push("Nothing pending on your side this week. We'll keep you posted as things move.");
    lines.push("");
  }
  lines.push("Reply to this email if you have any questions or need anything else.");
  lines.push("");
  lines.push("Best regards,");
  lines.push("Team Finanshels");
  const body = lines.join("\n");
  const subject = `Your weekly update from Finanshels — ${client.name}`;

  // Send via the AM's Gmail (or any Google-connected member as fallback).
  const { sendGmailAs } = await import("@/lib/google");
  const sender =
    (client.am_id
      ? (await supabase.from("member_connections").select("team_member_id").eq("team_member_id", client.am_id).eq("provider", "google").eq("connected", true).maybeSingle()).data?.team_member_id
      : null) ??
    (await getDriveCapableMemberId(session.profile.org_id));
  if (!sender) return { error: "No Google-connected sender found — connect Gmail on the AM or any team member." };
  for (const to of recipientList) {
    await sendGmailAs(sender as string, to, subject, body).catch(() => null);
  }
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: role,
    action: "weekly_digest_sent",
    module: "clients",
    resource_ref: `Weekly digest sent to ${recipientList.join(", ")}`,
    resource_id: clientId,
    resource_type: "client",
  });
  return { ok: true, sentTo: recipientList };
}

/**
 * Generate a one-page executive summary for a client by stitching together
 * everything we already know — call insights, business description, pain
 * points, intake form, contract scope, registration dates, banks/gateways/
 * software. Lands on clients.executive_summary. Master Admin only.
 */
export async function generateClientSummary(clientId: string): Promise<{ error?: string; summary?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name,industry,owner_name,entity_type,services,primary_contact_email,phone,business_description,pain_points,call_summary,call_insights,bank_names,payment_gateways,accounting_software,vat_registered,vat_trn,ct_registered,revenue_bracket,reg_facts,custom_code,trade_licence_no,facts")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found." };

  // Pull the latest contract analysis for this client (run_items kind='contract').
  const { data: contract } = await supabase
    .from("run_items")
    .select("data,onboarding_runs!inner(client_id)")
    .eq("onboarding_runs.client_id", clientId)
    .eq("kind", "contract")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contractData = contract?.data as Record<string, unknown> | null;

  // Pull the latest intake form responses (intake_forms).
  const { data: intake } = await supabase
    .from("intake_forms")
    .select("submitted,status")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ctx = {
    name: client.name,
    industry: client.industry,
    owner: client.owner_name,
    entity_type: client.entity_type,
    services: client.services,
    contact_email: client.primary_contact_email,
    phone: client.phone,
    business_description: client.business_description,
    pain_points: client.pain_points,
    call_summary: client.call_summary,
    call_insights: client.call_insights,
    banks: client.bank_names,
    gateways: client.payment_gateways,
    accounting_software: client.accounting_software,
    vat: { registered: client.vat_registered, trn: client.vat_trn },
    ct: { registered: client.ct_registered },
    revenue_bracket: client.revenue_bracket,
    reg_facts: client.reg_facts,
    custom_code: client.custom_code,
    trade_licence_no: client.trade_licence_no,
    facts: client.facts,
    contract: contractData,
    intake: (intake?.submitted as Record<string, unknown>) ?? null,
  };

  try {
    const summary = await runAi(session.profile.org_id, "handover_summary", {
      system:
        "You write tight, fact-grounded executive summaries for a UAE accounting firm. Output ONLY the summary as plain text (no markdown asterisks, no headings line with '#', no preamble). Use ONLY the facts in the JSON — never invent, never extrapolate. If a section's facts are missing, omit that section entirely.",
      prompt:
        `Write a one-page executive summary of this client. Structure:\n\n` +
        `THE BUSINESS\n2-3 sentences on what they do, how they make money, who they serve.\n\n` +
        `KEY PEOPLE & ENTITY\nOwner, entity type, contact email + phone, custom client code, trade licence, free zone (if known).\n\n` +
        `FINANCIAL FOOTPRINT\nRevenue bracket, banks, payment gateways, accounting software in use.\n\n` +
        `COMPLIANCE STATUS\nVAT registration + TRN, Corporate Tax status, key dates (incorporation, licence expiry, VAT/CT first filing) if known.\n\n` +
        `OUR ENGAGEMENT\nServices contracted, scope highlights, exclusions, payment terms, duration (from the contract).\n\n` +
        `PAIN POINTS & NEXT STEPS\nWhat the client raised and what we owe them next.\n\n` +
        `Each section: 1-4 short paragraphs or bullets. No filler. No 'as we discussed' / 'to summarise' phrasing. End with a one-line ROLE LINE: 'Account Manager: <name>' if we know it from the data.\n\n` +
        `Client data (JSON):\n${JSON.stringify(ctx).slice(0, 14000)}`,
    });
    const cleaned = summary.replace(/\*\*/g, "").trim();
    await supabase
      .from("clients")
      .update({ executive_summary: cleaned, executive_summary_at: new Date().toISOString() })
      .eq("id", clientId);
    revalidatePath(`/clients/${clientId}`);
    return { summary: cleaned };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI failed" };
  }
}

// Core extraction logic that's safe to call from server-side scripts (no
// session required). Returns the parsed insights AND applies the playbook
// updates. Used by both the user-facing extractCallInsights and the cron
// backfill route.
export async function _extractInsightsForClient(
  orgId: string, clientId: string, link: string, notes: string,
): Promise<{ error?: string; description?: string; painPoints?: string[]; summary?: string; sections?: InsightSection[]; source?: "fathom" | "notes" }> {
  // Admin client so this works from both user-authenticated flows AND the
  // CRON-protected backfill route (no cookies). All callers are themselves
  // gated upstream (masterAdminGate / cron secret).
  const supabase = createAdminClient();
  const { data: client } = await supabase.from("clients").select("name,industry,facts").eq("id", clientId).maybeSingle();

  let workingNotes = notes;
  let source: "fathom" | "notes" = "notes";
  if (!workingNotes.trim()) {
    const f = await fetchFathomNotes(orgId, { shareUrl: link, clientName: client?.name });
    if (f?.text) { workingNotes = f.text; source = "fathom"; if (!link && f.shareUrl) link = f.shareUrl; }
  }
  if (!workingNotes.trim()) {
    return { error: "No notes available — not in Fathom and none pasted." };
  }
  notes = workingNotes;
  try {
    const out = await runAi(orgId, "brief", {
      system: "You read accounting-firm client-call notes and capture everything useful for the client's playbook. Output ONLY JSON. Use ONLY what is actually in the notes — never invent; if something wasn't discussed, omit that field entirely (do NOT write 'not mentioned' or guess).",
      prompt:
        `From these call notes for "${client?.name ?? "the client"}" (industry: ${client?.industry ?? "unknown"}), return ONLY JSON: ` +
        `{"description":"3-4 sentence brief business description in the client's own words — what they do, how they make money, who they serve","painPoints":["specific problems/frustrations the client raised"],"summary":"2-3 sentence summary of the call",` +
        `"sections":[{"heading":"e.g. Business model / Systems & software / Banking / Compliance / Reporting & close cadence / Client expectations / Open items","body":"the relevant detail from the notes, bullet points separated by newlines"}],` +
        `"profile":{"ownerName":"","entityType":"mainland|free_zone|offshore","primaryContactEmail":"","phone":"","services":["accounting service lines the client wants, e.g. Bookkeeping, VAT, Corporate Tax"],"vatRegistered":"Yes|No","vatTrn":"","ctRegistered":"Yes|No","bankNames":[""],"paymentGateways":[""],"accountingSoftware":"","revenueBracket":"e.g. under 1M / 1-5M AED","revenueChannels":["the revenue streams the client mentioned, e.g. retail, online sales, services"],"expenseTypes":["the major expense categories the client mentioned, e.g. rent, payroll, marketing"]},` +
        `"extraFacts":[{"key":"snake_case_key","label":"Human Label","value":"the value"}]}. ` +
        `"profile" = only the fields actually stated in the notes (omit the rest). "extraFacts" = any other concrete business fact worth keeping that does NOT fit a profile field (e.g. trade license number, license expiry, financial year-end, number of branches, free-zone authority). Omit "profile"/"extraFacts" entirely if nothing applies. ` +
        `Recording link (reference only, you cannot watch it): ${link || "n/a"}.\n\nCall notes:\n${notes.slice(0, 12000)}`,
    });
    const s = out.indexOf("{"), e = out.lastIndexOf("}");
    const parsed = s >= 0 ? (JSON.parse(out.slice(s, e + 1)) as {
      description?: string; painPoints?: string[]; summary?: string; sections?: InsightSection[];
      profile?: Record<string, unknown>; extraFacts?: { key?: string; label?: string; value?: string }[];
    }) : {};
    const painPoints = Array.isArray(parsed.painPoints) ? parsed.painPoints.filter(Boolean) : [];
    const sections = Array.isArray(parsed.sections) ? parsed.sections.filter((x) => x?.heading && x?.body) : [];

    const pf = (parsed.profile ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : undefined);
    const colMap: Record<string, string | string[] | undefined> = {
      owner_name: str(pf.ownerName), entity_type: str(pf.entityType), primary_contact_email: str(pf.primaryContactEmail),
      phone: str(pf.phone), vat_registered: str(pf.vatRegistered), vat_trn: str(pf.vatTrn), ct_registered: str(pf.ctRegistered),
      accounting_software: str(pf.accountingSoftware), revenue_bracket: str(pf.revenueBracket),
      services: arr(pf.services), bank_names: arr(pf.bankNames), payment_gateways: arr(pf.paymentGateways),
      revenue_channels: arr(pf.revenueChannels),
    };
    const colUpdate: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(colMap)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) { if (v.length) colUpdate[k] = v; } else colUpdate[k] = v;
    }

    const extra = Array.isArray(parsed.extraFacts) ? parsed.extraFacts : [];
    const facts = { ...((client?.facts as Record<string, unknown>) ?? {}) };
    // Capture AI-extracted expense types as a fact so the COA generator and team can see what the client mentioned.
    const expenses = arr(pf.expenseTypes);
    if (expenses?.length) facts.expense_types = expenses;
    const defs: { org_id: string; key: string; label: string }[] = [];
    for (const f of extra) {
      const label = str(f?.label);
      const value = str(f?.value);
      if (!label || !value) continue;
      const key = (str(f?.key) ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
      if (!key) continue;
      facts[key] = value;
      defs.push({ org_id: orgId, key, label });
    }
    if (defs.length) {
      await supabase.from("client_field_defs").upsert(defs, { onConflict: "org_id,key", ignoreDuplicates: true });
    }

    await supabase.from("clients").update({
      ...(parsed.description ? { business_description: parsed.description } : {}),
      pain_points: painPoints,
      call_link: link || null,
      call_notes: notes,
      call_summary: parsed.summary ?? null,
      call_insights: { sections },
      ...colUpdate,
      ...(defs.length || expenses?.length ? { facts } : {}),
    }).eq("id", clientId);
    revalidatePath(`/clients/${clientId}`);
    return { description: parsed.description, painPoints, summary: parsed.summary, sections, source };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI failed" };
  }
}

export async function extractCallInsights(
  clientId: string, link: string, notes: string,
): Promise<{ error?: string; description?: string; painPoints?: string[]; summary?: string; sections?: InsightSection[]; source?: "fathom" | "notes" }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const gate = masterAdminGate(session); if (gate.error) return gate;
  return _extractInsightsForClient(session.profile.org_id, clientId, link, notes);
}


/** Saves manual edits to the playbook insights (AM / Master Admin). */
export async function saveCallInsights(
  clientId: string,
  input: {
    businessDescription: string;
    painPoints: string[];
    summary: string;
    sections: InsightSection[];
    /** Optional company-facts edits — when present, also patch the client record.
        Leave any field undefined to keep its current value; null/empty string clears it. */
    company?: {
      name?: string;
      owner_name?: string | null;
      industry?: string | null;
      entity_type?: string | null;
      primary_contact_email?: string | null;
      phone?: string | null;
      vat_registered?: string | null;
      vat_trn?: string | null;
      ct_registered?: string | null;
      bank_names?: string[] | null;
      payment_gateways?: string[] | null;
      accounting_software?: string | null;
      revenue_bracket?: string | null;
    };
  },
): Promise<{ error?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    business_description: input.businessDescription || null,
    pain_points: input.painPoints.filter(Boolean),
    call_summary: input.summary || null,
    call_insights: { sections: input.sections.filter((s) => s.heading?.trim() || s.body?.trim()) },
  };
  const c = input.company;
  if (c) {
    if (c.name !== undefined) patch.name = (c.name ?? "").trim() || null;
    if (c.owner_name !== undefined) patch.owner_name = (c.owner_name ?? "").trim() || null;
    if (c.industry !== undefined) patch.industry = (c.industry ?? "").trim() || null;
    if (c.entity_type !== undefined) patch.entity_type = (c.entity_type ?? "").trim() || null;
    if (c.primary_contact_email !== undefined) patch.primary_contact_email = (c.primary_contact_email ?? "").trim() || null;
    if (c.phone !== undefined) patch.phone = (c.phone ?? "").trim() || null;
    if (c.vat_registered !== undefined) patch.vat_registered = (c.vat_registered ?? "").trim() || null;
    if (c.vat_trn !== undefined) patch.vat_trn = (c.vat_trn ?? "").trim() || null;
    if (c.ct_registered !== undefined) patch.ct_registered = (c.ct_registered ?? "").trim() || null;
    if (c.bank_names !== undefined) patch.bank_names = (c.bank_names ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (c.payment_gateways !== undefined) patch.payment_gateways = (c.payment_gateways ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (c.accounting_software !== undefined) patch.accounting_software = (c.accounting_software ?? "").trim() || null;
    if (c.revenue_bracket !== undefined) patch.revenue_bracket = (c.revenue_bracket ?? "").trim() || null;
  }
  const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

/**
 * One-off backfill: make sure EVERY current client has a Drive folder id saved in
 * drive_folders.tree.id. For clients missing it, find-or-create the folder (ensureDriveFolder
 * reuses an existing folder of the same name, so docs already uploaded there are picked up) and
 * save the id. This is what the compliance-from-documents reader keys off. Admin / Ops Head only.
 */
export async function backfillDriveFolders(): Promise<{ error?: string; created?: number; existing?: number; failed?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["admin", "ops_head"].includes(role)) return { error: "Only an admin or ops head can run the Drive backfill." };
  const orgId = session.profile.org_id;
  const driveMember = (await getDriveCapableMemberId(orgId)) ?? session.teamMember?.id;
  if (!driveMember) return { error: "Connect a Google account first (My Connections → Connect Google)." };
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id,name").eq("org_id", orgId);
  let created = 0, existing = 0, failed = 0;
  for (const c of clients ?? []) {
    const { data: df } = await supabase.from("drive_folders").select("tree").eq("client_id", c.id).maybeSingle();
    if ((df?.tree as { id?: string } | null)?.id) { existing++; continue; }
    const folder = await createClientDriveFolder(driveMember, c.name);
    if (!folder?.id) { failed++; continue; }
    await supabase.from("drive_folders").upsert(
      { client_id: c.id, tree: { name: c.name, id: folder.id, link: folder.link } },
      { onConflict: "client_id" },
    );
    created++;
  }
  revalidatePath("/connections");
  return { created, existing, failed };
}

/**
 * Configure which email addresses can open the onboarding portal. `primaryEmail` is the main one
 * the access code is sent to; `altEmails` are additional teammates who may also sign in with
 * their own email + code. Updates the client record and every portal magic-link for the client.
 * AM and above only.
 */
export async function setClientPortalAccess(
  clientId: string, primaryEmail: string, altEmails: string[],
): Promise<{ error?: string; email?: string; altEmails?: string[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "ops_head", "admin"].includes(role)) return { error: "Only an Account Manager or admin can change portal access." };
  const valid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const primary = primaryEmail.trim().toLowerCase();
  if (!valid(primary)) return { error: "Enter a valid primary email address." };
  const alts = [...new Set(altEmails.map((e) => e.trim().toLowerCase()).filter((e) => valid(e) && e !== primary))];

  const supabase = await createClient();
  const { error: cErr } = await supabase.from("clients")
    .update({ primary_contact_email: primary })
    .eq("id", clientId).eq("org_id", session.profile.org_id);
  if (cErr) return { error: cErr.message };
  // Sync onto the client's portal link(s) so it takes effect immediately (and on the next dispatch).
  await supabase.from("magic_links")
    .update({ email: primary, alt_emails: alts })
    .eq("client_id", clientId).eq("org_id", session.profile.org_id).eq("purpose", "portal");
  revalidatePath(`/clients/${clientId}`);
  return { email: primary, altEmails: alts };
}

export interface NewClientInput {
  name: string;
  owner_name?: string;
  industry?: string;
  entity_type?: string;
  services?: string[];
  email?: string;
  phone?: string;
  am_id?: string;
  proposal_id?: string;
  target_go_live?: string;
  expected_onboarding_days?: number;
  trade_licence_no?: string;
  contract_start_date?: string;
  trade_licence_authority?: string;
}

/** Lifecycle statuses a user can manually set from the Clients list. */
export type ManualClientStatus = "lead" | "active" | "hold" | "paused" | "inactive";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "client"}-${crypto.randomBytes(2).toString("hex")}`;
}

export async function createClientAction(
  input: NewClientInput,
): Promise<{ error?: string; clientId?: string; driveLink?: string | null }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.name?.trim()) return { error: "Company name is required." };

  const supabase = await createClient();
  const amId = input.am_id || session.teamMember?.id || null;
  const tradeLicence = input.trade_licence_no?.trim() || null;
  const contractStart = input.contract_start_date || null;
  const customCode = buildClientCode({
    tradeLicence,
    companyName: input.name,
    contractStart,
  });
  const { data, error } = await supabase
    .from("clients")
    .insert({
      org_id: session.profile.org_id,
      name: input.name.trim(),
      owner_name: input.owner_name?.trim() || null,
      industry: input.industry || null,
      entity_type: input.entity_type || null,
      services: input.services ?? [],
      primary_contact_email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      am_id: amId,
      proposal_id: input.proposal_id?.trim() || null,
      target_go_live: input.target_go_live || null,
      expected_onboarding_days: input.expected_onboarding_days ?? null,
      trade_licence_no: tradeLicence,
      contract_start_date: contractStart,
      trade_licence_authority: input.trade_licence_authority?.trim() || null,
      custom_code: customCode,
      status: "lead",
      profile_complete: false,
      slug: slugify(input.name),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Create the client's Google Drive folder immediately, under the shared root.
  // Try the chosen AM's connected Drive first, then fall back to the creator's.
  const name = input.name.trim();
  const candidates = [amId, session.teamMember?.id].filter(
    (v, i, a): v is string => Boolean(v) && a.indexOf(v) === i,
  );
  let drive: { id: string; link: string } | null = null;
  for (const memberId of candidates) {
    drive = await createClientDriveFolder(memberId, name);
    if (drive) break;
  }
  if (drive) {
    await supabase.from("drive_folders").upsert(
      { client_id: data.id, tree: { name, id: drive.id, link: drive.link } },
      { onConflict: "client_id" },
    );
  }

  revalidatePath("/clients");
  return { clientId: data.id, driveLink: drive?.link ?? null };
}

/**
 * Group creation — one proposal, one owner, N companies. Creates the group
 * row, then a client + signed run per company (all bound to group_id), then
 * a SINGLE portal magic link bound to the group (covers all entities with
 * one login). Returns the group id + the portal URL.
 *
 * Per-entity work (COA, docs, intake, sign-off) stays on each run.
 * Shared by the group: portal access + primary contact + contract / deck.
 */
export interface NewGroupCompanyInput {
  name: string;
  owner_name?: string;
  industry?: string;
  entity_type?: string;
  am_id?: string;
  trade_licence_no?: string;
  contract_start_date?: string;
}
export interface NewGroupInput {
  group_name: string;
  primary_contact_name: string;
  primary_contact_email: string;
  proposal_id?: string;
  expected_onboarding_days?: number;
  template_id?: string;
  companies: NewGroupCompanyInput[];
}

export async function createClientGroupAction(
  input: NewGroupInput,
): Promise<{ error?: string; groupId?: string; clientIds?: string[]; runIds?: string[]; portalUrl?: string | null }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.group_name?.trim()) return { error: "Group name is required." };
  if (!input.primary_contact_email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.primary_contact_email)) {
    return { error: "A valid primary contact email is required (one login for the whole group)." };
  }
  const companies = (input.companies ?? []).filter((c) => c.name?.trim());
  if (companies.length < 1) return { error: "Add at least one company to the group." };
  if (companies.length > 12) return { error: "A group can have up to 12 companies for now." };

  const supabase = await createClient();
  const templateId = input.template_id || "medium-team";

  // 1. Create the group row.
  const { data: groupRow, error: gErr } = await supabase
    .from("client_groups")
    .insert({
      org_id: session.profile.org_id,
      name: input.group_name.trim(),
      primary_contact_name: input.primary_contact_name?.trim() || null,
      primary_contact_email: input.primary_contact_email.trim().toLowerCase(),
      proposal_id: input.proposal_id?.trim() || null,
      created_by: session.teamMember?.id ?? null,
    })
    .select("id")
    .single();
  if (gErr || !groupRow) return { error: gErr?.message ?? "Couldn't create the group." };
  const groupId = groupRow.id;

  // 2. For each company: create the client row + Drive folder + a run from
  //    the chosen template (the standard "Signed" flow, in-lined here so we
  //    can stamp group_id on both the client and the run in the same go).
  const clientIds: string[] = [];
  const runIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const days = input.expected_onboarding_days && input.expected_onboarding_days > 0 ? input.expected_onboarding_days : 28;
  const target = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  for (const c of companies) {
    const amId = c.am_id || session.teamMember?.id || null;
    const tradeLicence = c.trade_licence_no?.trim() || null;
    const contractStart = c.contract_start_date || null;
    const customCode = buildClientCode({
      tradeLicence,
      companyName: c.name,
      contractStart,
    });
    const { data: clientRow, error: cErr } = await supabase
      .from("clients")
      .insert({
        org_id: session.profile.org_id,
        group_id: groupId,
        name: c.name.trim(),
        owner_name: (c.owner_name?.trim() || input.primary_contact_name?.trim()) || null,
        industry: c.industry || null,
        entity_type: c.entity_type || null,
        primary_contact_email: input.primary_contact_email.trim().toLowerCase(),
        am_id: amId,
        proposal_id: input.proposal_id?.trim() || null,
        target_go_live: target,
        expected_onboarding_days: days,
        trade_licence_no: tradeLicence,
        contract_start_date: contractStart,
        custom_code: customCode,
        status: "onboarding", // bypass "lead" — group creation = signed by definition
        profile_complete: false,
        slug: slugify(c.name),
      })
      .select("id")
      .single();
    if (cErr || !clientRow) return { error: cErr?.message ?? `Couldn't create company ${c.name}.` };
    clientIds.push(clientRow.id);

    // Drive folder per entity (best-effort — group share happens at the portal layer).
    const candidates = [amId, session.teamMember?.id].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
    let drive: { id: string; link: string } | null = null;
    for (const memberId of candidates) {
      drive = await createClientDriveFolder(memberId, c.name.trim());
      if (drive) break;
    }
    if (drive) {
      await supabase.from("drive_folders").upsert(
        { client_id: clientRow.id, tree: { name: c.name.trim(), id: drive.id, link: drive.link } },
        { onConflict: "client_id" },
      );
    }

    // Run from the chosen template, stamped with group_id.
    const runId = await createRunFromTemplate(supabase, {
      orgId: session.profile.org_id,
      clientId: clientRow.id,
      amId,
      templateId,
      startedAt: today,
      targetCompletion: target,
    });
    await supabase.from("onboarding_runs").update({ group_id: groupId }).eq("id", runId);
    runIds.push(runId);
  }

  // 3. One portal magic link, group-scoped. Points to the first run/client as the
  //    landing entity; the portal switcher uses group_id to find siblings.
  const token = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await supabase.from("magic_links").insert({
    org_id: session.profile.org_id,
    group_id: groupId,
    run_id: runIds[0],
    client_id: clientIds[0],
    email: input.primary_contact_email.trim().toLowerCase(),
    token,
    purpose: "portal",
    expires_at: expires,
    alt_emails: [],
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const portalUrl = appUrl ? `${appUrl.replace(/\/+$/, "")}/portal/${token}` : `/portal/${token}`;

  revalidatePath("/clients");
  revalidatePath("/onboarding");
  return { groupId, clientIds, runIds, portalUrl };
}

/** Assign (or change) the Account Manager on a lead/client — the first step in the pipeline. */
/**
 * Rebuild the compliance calendar straight from the client's Drive folder +
 * portal docs. Used by the Playbook → Compliance Calendar "Rebuild from
 * Drive" button so that when a renewed trade licence (or any new file)
 * lands in Drive, the team doesn't need to re-open the run's step to refresh.
 *
 * Finds the latest active onboarding run, runs generateComplianceFromDocs,
 * then persists the result. AM-level and above only.
 */
export async function rebuildClientCompliance(clientId: string): Promise<{
  error?: string; ok?: boolean; itemCount?: number; empty?: boolean; runId?: string;
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "senior", "ops_head", "admin"].includes(role)) {
    return { error: "Only an AM/TL/Senior or above can rebuild the calendar." };
  }
  const supabase = await createClient();

  // Find the active onboarding run (newest, not closed/archived/complete). Compliance
  // items live on a run, not on the client directly — so we need an active run to
  // attach to. If none, fall back to the most recent non-archived run.
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,status,created_at,template_key")
    .eq("client_id", clientId)
    .neq("template_key", "lead-intake")
    .order("created_at", { ascending: false });
  const target =
    (runs ?? []).find((r) => !["complete", "closed", "archived"].includes(r.status)) ??
    (runs ?? []).find((r) => r.status !== "archived") ??
    (runs ?? [])[0];
  if (!target) return { error: "No onboarding run found for this client." };

  // generateComplianceFromDocs is the same function the run step uses — it scans
  // Drive (Company Documents folder) + portal-uploaded docs + appends the
  // statutory VAT / CT items based on client.vat_registered / ct_registered.
  const { generateComplianceFromDocs } = await import("../onboarding/[runId]/ai-actions");
  const res = await generateComplianceFromDocs(target.id);
  if (res.error) return { error: res.error, runId: target.id };
  const items = res.items ?? [];

  // Persist — same pattern as saveRunItems(kind=compliance).
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", target.id).maybeSingle();
  if (!run) return { error: "Run vanished mid-rebuild.", runId: target.id };
  await supabase.from("run_items").delete().eq("run_id", target.id).eq("kind", "compliance");
  if (items.length) {
    await supabase.from("run_items").insert(
      items.map((it, i) => ({
        run_id: target.id,
        client_id: run.client_id,
        kind: "compliance",
        data: { ...it, reminderDays: it.reminderDays ?? 30 },
        status: "open",
        sort: i,
      })),
    );
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/onboarding/${target.id}`);
  return { ok: true, itemCount: items.length, empty: !!res.empty, runId: target.id };
}

export async function setClientAm(clientId: string, amId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "ops_head", "admin"].includes(role))
    return { error: "Only an AM or above can assign the Account Manager." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ am_id: amId || null })
    .eq("id", clientId)
    .eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  revalidatePath("/onboarding");
  revalidatePath("/clients");
  return {};
}

/**
 * Create a compliance run (CT reg / VAT reg / filing / FTA amend) for an existing
 * client, picking the AM based on the configured tax-team capacity. The AM
 * picker is scoped to people under the Ops Head; if no AM is passed in,
 * suggestNextAm() picks the least-loaded one. Does NOT change the client's
 * status — compliance runs sit alongside the main onboarding.
 */
export async function createComplianceRun(input: {
  clientId: string;
  templateId: string;
  amId?: string | null;
}): Promise<{ error?: string; runId?: string; assignedAmId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "ops_head", "admin"].includes(role))
    return { error: "Only an AM or above can create compliance runs." };
  if (!input.clientId || !input.templateId) return { error: "Missing client or template." };
  const { suggestNextAm } = await import("@/lib/capacity");
  let amId = input.amId ?? null;
  if (!amId) {
    const pick = await suggestNextAm(session.profile.org_id);
    amId = pick?.id ?? session.teamMember?.id ?? null;
  }
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const target = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  try {
    const runId = await createRunFromTemplate(supabase, {
      orgId: session.profile.org_id,
      clientId: input.clientId,
      amId,
      templateId: input.templateId,
      startedAt: today,
      targetCompletion: target,
    });
    if (amId) {
      await supabase.from("notifications").insert({
        org_id: session.profile.org_id,
        run_id: runId,
        recipient_id: amId,
        kind: "info",
        title: "New compliance run assigned to you",
        body: input.templateId.replace(/-/g, " "),
      });
    }
    revalidatePath("/onboarding");
    revalidatePath(`/clients/${input.clientId}`);
    return { runId, assignedAmId: amId ?? undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create compliance run." };
  }
}

/** Change a client's lifecycle status (e.g. put on hold / pause / reactivate). AM and up. */
export async function setClientStatusAction(
  clientId: string,
  status: ManualClientStatus,
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "ops_head", "admin"].includes(role))
    return { error: "Only an AM or above can change a client's status." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", clientId)
    .eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };

  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: session.profile.role,
    action: "client_status_changed",
    module: "clients",
    resource_ref: `Client status set to ${status}`,
    resource_id: clientId,
    resource_type: "client",
    details: { status },
  });
  revalidatePath("/clients");
  return {};
}

/** Permanently delete a client and everything linked to it (runs cascade). Admin / Ops Head only. */
export async function deleteClientAction(clientId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["ops_head", "admin"].includes(role))
    return { error: "Only the Master Admin or Ops Head can delete a client." };

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .eq("org_id", session.profile.org_id)
    .maybeSingle();

  // All child tables (runs, steps, tasks, documents, messages, drive_folders…) are ON DELETE CASCADE.
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };

  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: session.profile.role,
    action: "client_deleted",
    module: "clients",
    resource_ref: `Deleted client ${client?.name ?? clientId} and all related runs`,
    resource_id: clientId,
    resource_type: "client",
    details: {},
  });
  revalidatePath("/clients");
  revalidatePath("/onboarding");
  return {};
}

/** Delete a client group AND all companies (+ their runs) inside it. Admin / Ops Head only. */
export async function deleteClientGroup(groupId: string): Promise<{ error?: string; deleted?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["ops_head", "admin"].includes(role)) return { error: "Only the Master Admin or Ops Head can delete a group." };
  const admin = createAdminClient();
  // Collect client IDs in the group first (for audit)
  const { data: groupClients } = await admin.from("clients").select("id,name").eq("group_id", groupId).eq("org_id", session.profile.org_id);
  const count = groupClients?.length ?? 0;
  // Delete all clients in the group — cascade removes runs, tasks, documents, etc.
  if (count > 0) {
    const { error: clientErr } = await admin.from("clients").delete().eq("group_id", groupId).eq("org_id", session.profile.org_id);
    if (clientErr) return { error: clientErr.message };
  }
  // Delete the group record itself
  const { error: groupErr } = await admin.from("client_groups").delete().eq("id", groupId).eq("org_id", session.profile.org_id);
  if (groupErr) return { error: groupErr.message };
  await admin.from("audit_events").insert({ org_id: session.profile.org_id, actor_id: session.profile.id, action: "delete_group", target_kind: "client_group", target_id: groupId, details: { count } });
  revalidatePath("/clients");
  revalidatePath("/onboarding");
  return { deleted: count };
}

/** Bulk status change across selected clients. AM and up. */
export async function bulkSetClientStatus(ids: string[], status: ManualClientStatus): Promise<{ error?: string; count?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "ops_head", "admin"].includes(role)) return { error: "Only an AM or above can change client status." };
  if (!ids.length) return { error: "Nothing selected." };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ status }).in("id", ids).eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id, actor: session.teamMember?.full_name ?? session.email, actor_role: session.profile.role,
    action: "client_status_changed_bulk", module: "clients", resource_ref: `${ids.length} clients set to ${status}`, resource_type: "client", details: { ids, status },
  });
  revalidatePath("/clients");
  return { count: ids.length };
}

/** Save the Trade Licence # / contract start / custom code on a client.  Master Admin only.
 *  Re-computes the custom_code automatically so it stays in sync. */
export async function saveClientCustomFields(
  clientId: string,
  input: { tradeLicence?: string | null; contractStart?: string | null },
): Promise<{ error?: string; code?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session);
  if (gate.error) return gate;
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name,trade_licence_no,contract_start_date")
    .eq("id", clientId)
    .eq("org_id", session!.profile.org_id)
    .maybeSingle();
  if (!client) return { error: "Client not found." };
  const tradeLicence = input.tradeLicence === undefined ? client.trade_licence_no : input.tradeLicence?.trim() || null;
  const contractStart = input.contractStart === undefined ? client.contract_start_date : input.contractStart || null;
  const code = buildClientCode({ tradeLicence, companyName: client.name, contractStart });
  const { error } = await supabase
    .from("clients")
    .update({ trade_licence_no: tradeLicence, contract_start_date: contractStart, custom_code: code })
    .eq("id", clientId)
    .eq("org_id", session!.profile.org_id);
  if (error) return { error: error.message };
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { code };
}

/** Bulk delete selected clients (runs cascade). Admin / Ops Head only. */
export async function bulkDeleteClients(ids: string[]): Promise<{ error?: string; count?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["ops_head", "admin"].includes(role)) return { error: "Only the Master Admin or Ops Head can delete clients." };
  if (!ids.length) return { error: "Nothing selected." };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").delete().in("id", ids).eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id, actor: session.teamMember?.full_name ?? session.email, actor_role: session.profile.role,
    action: "client_deleted_bulk", module: "clients", resource_ref: `Deleted ${ids.length} clients and their runs`, resource_type: "client", details: { ids },
  });
  revalidatePath("/clients");
  revalidatePath("/onboarding");
  return { count: ids.length };
}

/** Permanently delete a single onboarding run (its steps/tasks cascade). Admin / Ops Head only. */
export async function deleteRunAction(runId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["ops_head", "admin"].includes(role))
    return { error: "Only the Master Admin or Ops Head can delete an onboarding run." };

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("client_id")
    .eq("id", runId)
    .eq("org_id", session.profile.org_id)
    .maybeSingle();

  const { error } = await supabase
    .from("onboarding_runs")
    .delete()
    .eq("id", runId)
    .eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };

  // Return the client to a non-onboarding status so it isn't stuck.
  if (run?.client_id) {
    await supabase.from("clients").update({ status: "signed" }).eq("id", run.client_id);
  }
  await supabase.from("audit_events").insert({
    org_id: session.profile.org_id,
    actor: session.teamMember?.full_name ?? session.email,
    actor_role: session.profile.role,
    action: "run_deleted",
    module: "onboarding",
    resource_ref: "Deleted onboarding run and all its steps/tasks",
    resource_id: runId,
    resource_type: "run",
    details: {},
  });
  revalidatePath("/clients");
  revalidatePath("/onboarding");
  return {};
}

/** Demo trigger: set client to onboarding and create the run from the chosen template. */
export async function markSignedAction(
  clientId: string,
  templateId: string = "medium-team",
): Promise<{ error?: string; runId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };

  const supabase = await createClient();

  // The Account Manager is the one assigned when the client was created. Only
  // fall back to the person triggering the run if no AM was ever set.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("am_id")
    .eq("id", clientId)
    .maybeSingle();
  const amId = clientRow?.am_id ?? session.teamMember?.id ?? null;

  // Guard: if a real run already exists, just return it. A stub `lead-intake`
  // run (created by the standalone Send-Intake flow before sign-off) is NOT a
  // real onboarding — we promote it: keep the intake answers & portal link
  // pointing at the new run, then drop the stub.
  const { data: existing } = await supabase
    .from("onboarding_runs")
    .select("id,template_key")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  const realRun = (existing ?? []).find((r) => r.template_key !== "lead-intake");
  if (realRun) {
    await supabase.from("clients").update({ status: "onboarding" }).eq("id", clientId);
    return { runId: realRun.id };
  }
  const stubRun = (existing ?? []).find((r) => r.template_key === "lead-intake") ?? null;

  const { error: ue } = await supabase
    .from("clients")
    .update({ status: "onboarding", am_id: amId })
    .eq("id", clientId);
  if (ue) return { error: ue.message };

  const today = new Date().toISOString().slice(0, 10);
  // Use the timeline captured at client creation: explicit go-live date wins,
  // else expected days from today, else default 28 days.
  const { data: tl } = await supabase
    .from("clients")
    .select("target_go_live,expected_onboarding_days")
    .eq("id", clientId)
    .maybeSingle();
  const days = tl?.expected_onboarding_days && tl.expected_onboarding_days > 0 ? tl.expected_onboarding_days : 28;
  const target = tl?.target_go_live
    ? tl.target_go_live
    : new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  try {
    const runId = await createRunFromTemplate(supabase, {
      orgId: session.profile.org_id,
      clientId,
      amId,
      templateId,
      startedAt: today,
      targetCompletion: target,
    });

    // Promote stub: re-point intake answers + portal link from the stub run to
    // the real run, then drop the stub. Done AFTER createRunFromTemplate
    // succeeds so a failure can't orphan the intake data.
    if (stubRun?.id) {
      await supabase.from("intake_forms").update({ run_id: runId }).eq("run_id", stubRun.id);
      await supabase.from("magic_links").update({ run_id: runId }).eq("run_id", stubRun.id);
      await supabase.from("onboarding_runs").delete().eq("id", stubRun.id);
      await supabase.from("audit_events").insert({
        org_id: session.profile.org_id,
        actor: session.teamMember?.full_name ?? session.email,
        actor_role: session.profile.role,
        action: "stub_intake_promoted",
        module: "onboarding",
        resource_ref: "Lead-intake stub run promoted to real onboarding",
        resource_id: runId,
        resource_type: "run",
        details: { stub_run_id: stubRun.id },
      });
    }

    const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
    const clientName = client?.name ?? null;
    const drive = amId && clientName ? await createClientDriveFolder(amId, clientName) : null;
    if (!drive) {
      await supabase.from("audit_events").insert({
        org_id: session.profile.org_id,
        actor: session.teamMember?.full_name ?? session.email,
        actor_role: session.profile.role,
        action: "drive_folder_failed",
        module: "onboarding",
        resource_ref: `Drive folder not created for ${clientName ?? "client"}`,
        resource_id: runId,
        resource_type: "run",
        details: { client_id: clientId },
      });
      return {
        error: "Onboarding run was created, but the Drive folder was not. Reconnect Google and confirm you have access to the master Drive folder.",
        runId,
      };
    }
    await supabase.from("drive_folders").upsert(
      { client_id: clientId, tree: { name: clientName, id: drive.id, link: drive.link } },
      { onConflict: "client_id" },
    );
    await supabase.from("audit_events").insert({
      org_id: session.profile.org_id,
      actor: session.teamMember?.full_name ?? session.email,
      actor_role: session.profile.role,
      action: "run_created",
      module: "onboarding",
      resource_ref: "Onboarding run created",
      resource_id: runId,
      resource_type: "run",
      details: drive ? { drive_folder_id: drive.id, drive_link: drive.link } : {},
    });
    revalidatePath("/clients");
    revalidatePath("/onboarding");
    revalidatePath("/my-work");
    return { runId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create run" };
  }
}

// ── Meeting recordings ───────────────────────────────────────────────────────
// Every client meeting is saved with its recording link and prepared notes. If only a
// recording link is given we pull the notes from Fathom and summarise them with AI.

export interface ClientMeeting {
  id: string;
  title: string;
  meeting_date: string | null;
  recording_link: string | null;
  notes: string | null;
  summary: string | null;
  source: string;
  created_at: string;
}

export async function addClientMeeting(
  clientId: string,
  input: { title?: string; date?: string; recordingLink?: string; notes?: string },
): Promise<{ error?: string; source?: "fathom" | "manual" }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  const recordingLink = (input.recordingLink ?? "").trim();
  let notes = (input.notes ?? "").trim();
  let source: "fathom" | "manual" = "manual";
  let title = (input.title ?? "").trim();

  // No notes? Pull them (and a title) from Fathom by the recording link or the client name.
  if (!notes) {
    const f = await fetchFathomNotes(session.profile.org_id, { shareUrl: recordingLink, clientName: client.name });
    if (f?.text) { notes = f.text; source = "fathom"; if (!title && f.title) title = f.title; }
  }
  if (!notes && !recordingLink) {
    return { error: "Add a recording link or paste the notes. If a Fathom link is given, leave notes blank to auto-fetch." };
  }

  // A short AI summary of the meeting (best-effort — never blocks saving).
  let summary: string | null = null;
  if (notes) {
    try {
      summary = await runAi(session.profile.org_id, "brief", {
        system: "You summarise an accounting-firm client meeting in 2-3 plain sentences. Use ONLY what is in the notes. No preamble.",
        prompt: `Meeting notes for ${client.name}:\n\n${notes.slice(0, 12000)}`,
      });
      summary = (summary ?? "").trim() || null;
    } catch { /* summary is optional */ }
  }

  const { error } = await supabase.from("client_meetings").insert({
    org_id: session.profile.org_id,
    client_id: clientId,
    title: title || "Client meeting",
    meeting_date: input.date || null,
    recording_link: recordingLink || null,
    notes: notes || null,
    summary,
    source,
    created_by: session.teamMember?.full_name ?? session.email,
  });
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return { source };
}

/**
 * Manual sync — pulls every meeting from Fathom whose title matches the client name
 * and inserts any not already in client_meetings. Dedupes by recording_link so the
 * action is safe to re-run. Returns counts so the UI can show "Added 2 · 3 already on file".
 */
export async function syncFathomMeetingsForClient(
  clientId: string,
): Promise<{ error?: string; added?: number; skipped?: number; scanned?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name,primary_contact_email").eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  const meetings = await listFathomMeetings(session.profile.org_id);
  if (!meetings) return { error: "Fathom isn't connected for this org, or the API key is invalid. Connect Fathom in Settings." };

  // Match on EITHER (a) the client's email domain appearing in the meeting
  // attendees, OR (b) any distinctive token from the client name appearing
  // in the meeting title (after stripping legal suffixes like FZE/LLC). The
  // first catches calls booked under the client's own email; the second
  // catches "Onboarding <> Emargrow" / "Onboarding <> BSK IT Consulting FZE".
  const cleanForMatch = (raw: string) => raw
    .toLowerCase()
    .replace(/\b(fze|fzco|fz|llc|l\.l\.c|ltd|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const nameTokens = cleanForMatch(client.name).split(/\s+/).filter((w) => w.length >= 3);
  const clientEmail = (client.primary_contact_email ?? "").trim().toLowerCase();
  const clientDomain = clientEmail.split("@")[1] ?? "";
  const GENERIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "me.com", "aol.com"]);
  const domainUsable = !!clientDomain && !GENERIC_DOMAINS.has(clientDomain);
  const matches = meetings.filter((m) => {
    const t = cleanForMatch(m.title ?? m.meeting_title ?? "");
    if (nameTokens.length && nameTokens.every((tk) => t.includes(tk))) return true;
    if (domainUsable) {
      const emails = fathomMeetingEmails(m);
      if (emails.some((e) => e.endsWith("@" + clientDomain))) return true;
    }
    return false;
  });
  if (!matches.length) return { added: 0, skipped: 0, scanned: meetings.length };

  // Dedupe by recording_link already on file
  const { data: existingRows } = await supabase
    .from("client_meetings").select("recording_link").eq("client_id", clientId);
  const have = new Set((existingRows ?? []).map((r) => (r.recording_link as string | null) ?? "").filter(Boolean));

  let added = 0, skipped = 0;
  for (const m of matches) {
    const link = m.share_url || m.url || "";
    if (!link) { skipped++; continue; }
    if (have.has(link)) { skipped++; continue; }
    const notes = fathomMeetingNotes(m);
    const when = m.scheduled_start_time || m.meeting_time || m.created_at || null;
    const { error } = await supabase.from("client_meetings").insert({
      org_id: session.profile.org_id,
      client_id: clientId,
      title: m.title || m.meeting_title || `${client.name} — call`,
      meeting_date: when ? new Date(when).toISOString().slice(0, 10) : null,
      recording_link: link,
      notes: notes || null,
      summary: null,
      source: "fathom",
      created_by: session.teamMember?.full_name ?? session.email,
    });
    if (error) { skipped++; continue; }
    added++;
  }

  // Keep clients.call_link in sync with the latest matched meeting and run the
  // AI extractor on its notes so the playbook (business description, pain
  // points, VAT/CT registration, revenue/expense channels, banks, software,
  // sections) gets populated automatically — no separate "Extract insights"
  // click needed.
  let insightsRun = false;
  if (matches.length) {
    const latest = matches[0];
    const latestLink = latest.share_url || latest.url || null;
    const latestNotes = fathomMeetingNotes(latest);
    if (latestLink || latestNotes) {
      await supabase.from("clients").update({
        ...(latestLink ? { call_link: latestLink } : {}),
        ...(latestNotes ? { call_notes: latestNotes } : {}),
      }).eq("id", clientId);
    }
    if (latestNotes) {
      const r = await _extractInsightsForClient(session.profile.org_id, clientId, latestLink ?? "", latestNotes);
      insightsRun = !r.error;
    }
  }

  revalidatePath(`/clients/${clientId}`);
  return { added, skipped, scanned: meetings.length, insightsRun } as { error?: string; added?: number; skipped?: number; scanned?: number; insightsRun?: boolean };
}

export async function deleteClientMeeting(meetingId: string, clientId: string): Promise<{ error?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("client_meetings").delete().eq("id", meetingId);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

// ── System access, editable from the client playbook ─────────────────────────
// Access items normally come from the run's access step + the client confirming in the portal.
// But the team also needs to add an item that was never configured, or mark one as shared
// (via Email / Zoho Vault / viewer access) without waiting on the portal. These act on the
// run_items (kind 'access') of the client's most recent run.

async function latestRunId(supabase: Awaited<ReturnType<typeof createClient>>, clientId: string): Promise<string | null> {
  const { data } = await supabase.from("onboarding_runs").select("id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

/** Team adds a system-access item directly from the playbook. */
export async function addPlaybookAccess(
  clientId: string,
  input: { label: string; sharedVia?: string; status?: "requested" | "granted" },
): Promise<{ error?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const label = input.label.trim();
  if (!label) return { error: "Name the access first." };
  const supabase = await createClient();
  const runId = await latestRunId(supabase, clientId);
  if (!runId) return { error: "Create an onboarding run for this client first." };
  const status = input.status ?? (input.sharedVia ? "granted" : "requested");
  const item = {
    id: `manual_${crypto.randomBytes(3).toString("hex")}`,
    label, method: input.sharedVia ?? "", email: "", sop: [],
    status, sharedVia: input.sharedVia ?? undefined, manual: true,
  };
  const { error } = await supabase.from("run_items").insert({ run_id: runId, client_id: clientId, kind: "access", data: item, status });
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

/** Team marks an access item shared (via Email / Vault / …) or back to pending, from the playbook. */
export async function setPlaybookAccessStatus(
  rowId: string, clientId: string, status: "requested" | "granted", sharedVia?: string,
): Promise<{ error?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const { data: row } = await supabase.from("run_items").select("data").eq("id", rowId).eq("kind", "access").maybeSingle();
  if (!row) return { error: "Access item not found." };
  const data = { ...(row.data as Record<string, unknown>), status, manual: true, ...(sharedVia !== undefined ? { sharedVia } : {}) };
  const { error } = await supabase.from("run_items").update({ data, status }).eq("id", rowId);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

/**
 * Standalone intake — no onboarding portal involved. Generate (or reuse) a
 * public NO-LOGIN /intake/<token> link for the client and return rendered
 * Email + WhatsApp drafts so the AM can preview, edit, and send.
 *
 * If the client has no onboarding run yet, a lightweight stub run is created
 * (template_key="lead-intake", status="pending") solely to satisfy the
 * intake_forms.run_id NOT NULL constraint. The stub is filtered out of the
 * main runs/pipeline views.
 */
export interface StandaloneIntakePrep {
  url: string;
  token: string;
  subject: string;
  body: string;
  whatsapp: string;
  contactName: string;
  clientName: string;
  clientEmail: string | null;
}

export async function prepareStandaloneIntake(clientId: string): Promise<{ error?: string; data?: StandaloneIntakePrep }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "senior", "ops_head", "admin"].includes(role))
    return { error: "Only AM / TL / Senior or admin can send the intake form." };
  if (!clientId) return { error: "Pick a client first." };

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name,owner_name,primary_contact_email")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found." };

  let { data: run } = await supabase
    .from("onboarding_runs")
    .select("id,org_id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) {
    const { data: inserted, error: insErr } = await supabase
      .from("onboarding_runs")
      .insert({
        org_id: session.profile.org_id,
        client_id: clientId,
        am_id: session.teamMember?.id ?? null,
        status: "pending",
        template_key: "lead-intake",
        started_at: new Date().toISOString().slice(0, 10),
        current_stage: 1,
        progress: 0,
      })
      .select("id,org_id")
      .single();
    if (insErr || !inserted) return { error: insErr?.message ?? "Couldn't prepare the intake." };
    run = inserted;
  }

  const { data: existing } = await supabase
    .from("magic_links")
    .select("token")
    .eq("run_id", run.id)
    .eq("purpose", "intake")
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { error } = await supabase.from("magic_links").insert({
      org_id: run.org_id,
      run_id: run.id,
      client_id: clientId,
      email: client.primary_contact_email ?? "",
      token,
      purpose: "intake",
      expires_at: expires,
    });
    if (error) return { error: error.message };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  const url = `${appUrl}/intake/${token}`;
  const contactName = client.owner_name?.trim() || "there";
  const companyName = client.name?.trim() || "your company";
  const fields = { contactName, companyName, portalUrl: url };
  return {
    data: {
      url,
      token,
      subject: INTAKE_EMAIL_SUBJECT,
      body: renderIntakeEmail(fields),
      whatsapp: renderIntakeWhatsapp(fields),
      contactName,
      clientName: companyName,
      clientEmail: client.primary_contact_email ?? null,
    },
  };
}

export async function sendStandaloneIntakeEmail(
  clientId: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.teamMember?.id) return { error: "Connect Google in Settings first (no team member linked to your account)." };
  if (!to?.trim()) return { error: "No recipient email." };
  if (!subject?.trim() || !body?.trim()) return { error: "Subject and body are required." };

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("primary_contact_email").eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };

  const res = await sendGmailAs(session.teamMember.id, to.trim(), subject.trim(), body);
  if (!res.ok) return { error: res.error ?? "Send failed." };

  if (!client.primary_contact_email) {
    await supabase.from("clients").update({ primary_contact_email: to.trim() }).eq("id", clientId);
  }
  return { ok: true };
}

export async function deletePlaybookAccess(rowId: string, clientId: string): Promise<{ error?: string }> {
  const session = await getSession();
  const gate = masterAdminGate(session); if (gate.error) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("run_items").delete().eq("id", rowId).eq("kind", "access");
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

/** Duplicate a client (copies core fields, resets status to lead, no run/docs copied). */
export async function copyClientAction(clientId: string): Promise<{ error?: string; clientId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("clients")
    .select("name,owner_name,industry,entity_type,services,primary_contact_email,am_id,trade_licence_no,contract_start_date,expected_onboarding_days,group_id")
    .eq("id", clientId)
    .eq("org_id", session.profile.org_id)
    .maybeSingle();
  if (!src) return { error: "Client not found." };
  const newName = `${src.name} (copy)`;
  const customCode = buildClientCode({ tradeLicence: src.trade_licence_no, companyName: newName, contractStart: src.contract_start_date });
  const { data, error } = await supabase
    .from("clients")
    .insert({
      org_id: session.profile.org_id,
      name: newName,
      owner_name: src.owner_name,
      industry: src.industry,
      entity_type: src.entity_type,
      services: src.services ?? [],
      primary_contact_email: src.primary_contact_email,
      am_id: src.am_id,
      trade_licence_no: src.trade_licence_no,
      contract_start_date: src.contract_start_date,
      expected_onboarding_days: src.expected_onboarding_days,
      group_id: src.group_id ?? null,
      custom_code: customCode,
      status: "lead",
      profile_complete: false,
      slug: slugify(newName),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/clients");
  return { clientId: data.id };
}

// ─── Payment plan ─────────────────────────────────────────────────────────────

export async function savePaymentPlan(input: {
  clientId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  startDate: string | null;
  notes: string | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.from("client_payment_plans").upsert(
    { org_id: session.profile.org_id, client_id: input.clientId, billing_cycle: input.billingCycle, amount: input.amount, currency: input.currency, start_date: input.startDate || null, notes: input.notes || null, updated_at: new Date().toISOString() },
    { onConflict: "client_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true };
}

export async function generatePaymentSchedule(clientId: string): Promise<{ error?: string; ok?: boolean; count?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: plan } = await supabase.from("client_payment_plans").select("*").eq("client_id", clientId).maybeSingle();
  if (!plan) return { error: "Save a payment plan first." };
  const start = plan.start_date ? new Date(plan.start_date + "T00:00:00Z") : new Date();
  const cycle = plan.billing_cycle as string;
  const entries: { org_id: string; client_id: string; due_date: string; period_label: string; amount: number; status: string }[] = [];
  const months = { monthly: 1, quarterly: 3, annual: 12 }[cycle] ?? 1;
  const count = cycle === "annual" ? 3 : cycle === "quarterly" ? 8 : 12;
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i * months);
    const iso = d.toISOString().slice(0, 10);
    const periodLabel = cycle === "monthly"
      ? d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
      : cycle === "quarterly" ? `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
      : `FY ${d.getUTCFullYear()}`;
    entries.push({ org_id: session.profile.org_id, client_id: clientId, due_date: iso, period_label: periodLabel, amount: Number(plan.amount), status: new Date(iso) < new Date() ? "overdue" : "pending" });
  }
  await supabase.from("client_payment_entries").delete().eq("client_id", clientId).eq("status", "pending").eq("status", "overdue");
  // Only delete future pending entries; keep paid/invoiced ones
  await supabase.from("client_payment_entries").delete().eq("client_id", clientId).in("status", ["pending", "overdue"]);
  const { error } = await supabase.from("client_payment_entries").insert(entries);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, count: entries.length };
}

export async function savePaymentEntry(input: {
  id?: string;
  clientId: string;
  dueDate: string;
  periodLabel: string | null;
  amount: number | null;
  invoiceNo: string | null;
  invoiceLink: string | null;
  status: string;
  paidDate: string | null;
  notes: string | null;
}): Promise<{ error?: string; ok?: boolean; id?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const payload = {
    org_id: session.profile.org_id,
    client_id: input.clientId,
    due_date: input.dueDate,
    period_label: input.periodLabel || null,
    amount: input.amount ?? null,
    invoice_no: input.invoiceNo || null,
    invoice_link: input.invoiceLink || null,
    status: input.status,
    paid_date: input.paidDate || null,
    notes: input.notes || null,
    updated_at: new Date().toISOString(),
  };
  let entryId = input.id;
  if (input.id) {
    const { error } = await supabase.from("client_payment_entries").update(payload).eq("id", input.id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase.from("client_payment_entries").insert(payload).select("id").single();
    if (error) return { error: error.message };
    entryId = data.id;
  }
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true, id: entryId };
}

export async function deletePaymentEntry(id: string, clientId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.from("client_payment_entries").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}

// ─── Document audit ────────────────────────────────────────────────────────────

const REQUIRED_DOCS = ["Trade Licence", "MOA", "EID / Passport", "Incorporation Certificate"] as const;

export async function auditClientDocs(clientId: string): Promise<{
  error?: string;
  found: string[];
  missing: string[];
  scanned: number;
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in.", found: [], missing: [...REQUIRED_DOCS], scanned: 0 };
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  const clientName = client?.name ?? "";

  // Get a Drive-capable member
  const driveMemberId = await getDriveCapableMemberId(session.profile.org_id, null);

  // Get stored folder ID
  const { data: driveFolder } = await admin.from("drive_folders").select("tree").eq("client_id", clientId).maybeSingle();
  const storedFolderId = (driveFolder?.tree as { id?: string } | null)?.id;

  let driveFiles: { name: string; id: string; mimeType: string }[] = [];
  if (driveMemberId) {
    const { listDriveDocsByFolderId, listClientDriveDocs } = await import("@/lib/google");
    driveFiles = storedFolderId
      ? await listDriveDocsByFolderId(driveMemberId, storedFolderId)
      : await listClientDriveDocs(driveMemberId, clientName);
  }

  // Also check portal-uploaded documents
  const { data: portalDocs } = await admin.from("documents").select("label,status").eq("client_id", clientId).eq("status", "uploaded");
  const allNames = [
    ...driveFiles.map((f) => f.name.toLowerCase()),
    ...(portalDocs ?? []).map((d) => (d.label as string).toLowerCase()),
  ];

  const found: string[] = [];
  const missing: string[] = [];
  for (const doc of REQUIRED_DOCS) {
    const kw = doc === "EID / Passport"
      ? /eid|passport|emirates.id|shareholder/i
      : doc === "MOA"
      ? /moa|memorandum|articles/i
      : doc === "Trade Licence"
      ? /trade.licen|commercial.licen/i
      : /incorporat|certif.*incorporat/i;
    const hit = allNames.some((n) => kw.test(n));
    if (hit) found.push(doc); else missing.push(doc);
  }

  return { found, missing, scanned: driveFiles.length + (portalDocs?.length ?? 0) };
}

export async function auditAllClients(): Promise<{
  error?: string;
  results: { clientId: string; clientName: string; found: string[]; missing: string[] }[];
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in.", results: [] };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["admin", "ops_head", "am"].includes(role)) return { error: "Permission denied.", results: [] };
  const admin = createAdminClient();
  const { data: clients } = await admin.from("clients").select("id,name").eq("org_id", session.profile.org_id).eq("status", "active");
  const results: { clientId: string; clientName: string; found: string[]; missing: string[] }[] = [];
  for (const c of clients ?? []) {
    const res = await auditClientDocs(c.id);
    results.push({ clientId: c.id, clientName: c.name, found: res.found, missing: res.missing });
  }
  return { results };
}

// ─── AML compliance ────────────────────────────────────────────────────────────

export async function saveAmlRecord(input: {
  clientId: string;
  status: string;
  notes: string | null;
  signingLink: string | null;
  signingCompletedLink: string | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.from("aml_records").upsert(
    {
      org_id: session.profile.org_id,
      client_id: input.clientId,
      status: input.status,
      notes: input.notes || null,
      signing_link: input.signingLink || null,
      signing_completed_link: input.signingCompletedLink || null,
      completed_by: input.status === "completed" ? (session.teamMember?.full_name ?? null) : undefined,
      completed_at: input.status === "completed" ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) return { error: error.message };
  // If link_sent or signed, create an admin_tasks chip so the AM/team knows to follow up.
  if (input.status === "link_sent" || input.status === "signed") {
    const { data: client } = await supabase.from("clients").select("name,am_id").eq("id", input.clientId).maybeSingle();
    const ownerId = (client as { am_id?: string | null } | null)?.am_id ?? session.teamMember?.id ?? null;
    if (ownerId) {
      const taskTitle = input.status === "link_sent"
        ? `AML: Share signing link — ${client?.name ?? "Client"}`
        : `AML: Signing completed — update & close — ${client?.name ?? "Client"}`;
      await supabase.from("admin_tasks").insert({
        org_id: session.profile.org_id,
        owner_id: ownerId,
        kind: "aml_followup",
        client_id: input.clientId,
        title: taskTitle,
        body: input.status === "link_sent"
          ? `Send the AML signing link to the client: ${input.signingLink ?? "(link not yet set)"}`
          : `Signing completed. Confirm with the client and mark AML as completed. Link: ${input.signingCompletedLink ?? "(link not set)"}`,
      });
    }
  }
  revalidatePath("/aml");
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true };
}

export async function getAmlClients(): Promise<{
  error?: string;
  clients: {
    clientId: string; clientName: string; status: string; notes: string | null;
    signingLink: string | null; signingCompletedLink: string | null;
    completedAt: string | null; driveLink: string | null; runId: string | null;
  }[];
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in.", clients: [] };
  const supabase = await createClient();
  // All active/onboarded clients (status: active, hold, paused, complete-ish)
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id,name,status")
    .eq("org_id", session.profile.org_id)
    .in("status", ["active", "hold", "paused", "signed"]);
  if (!clientRows?.length) return { clients: [] };
  const clientIds = clientRows.map((c) => c.id);

  const [{ data: amlRows }, { data: driveFolders }, { data: runRows }] = await Promise.all([
    supabase.from("aml_records").select("*").in("client_id", clientIds),
    supabase.from("drive_folders").select("client_id,tree").in("client_id", clientIds),
    supabase.from("onboarding_runs").select("id,client_id").in("client_id", clientIds).not("status", "in", "(archived,closed)").order("created_at", { ascending: false }),
  ]);

  const amlByClient = new Map((amlRows ?? []).map((r) => [r.client_id as string, r]));
  const driveByClient = new Map((driveFolders ?? []).map((d) => [d.client_id as string, ((d.tree as { link?: string } | null)?.link) ?? null]));
  const runByClient = new Map<string, string>();
  for (const r of (runRows ?? [])) {
    if (!runByClient.has(r.client_id as string)) runByClient.set(r.client_id as string, r.id as string);
  }

  return {
    clients: clientRows.map((c) => {
      const aml = amlByClient.get(c.id);
      return {
        clientId: c.id,
        clientName: c.name,
        status: (aml?.status as string) ?? "pending",
        notes: (aml?.notes as string | null) ?? null,
        signingLink: (aml?.signing_link as string | null) ?? null,
        signingCompletedLink: (aml?.signing_completed_link as string | null) ?? null,
        completedAt: (aml?.completed_at as string | null) ?? null,
        driveLink: driveByClient.get(c.id) ?? null,
        runId: runByClient.get(c.id) ?? null,
      };
    }),
  };
}
