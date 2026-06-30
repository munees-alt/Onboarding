"use server";

import crypto from "crypto";
import coaDataRaw from "@/lib/coa-templates.json";
import { runAi, getAiConfig } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadDriveFile, driveFileIdFromLink, listClientDriveDocs, listDriveDocsByFolderId, getDriveCapableMemberId } from "@/lib/google";
import { fetchFathomNotes } from "@/lib/fathom";
import { completeStep } from "./actions";
import { renderWelcomeEmail } from "@/lib/welcome-email";
import { formatEngagementPeriod } from "@/lib/contract-format";

type CoaAccount = { code: string; account: string; description: string; tag: string; category: string; subcategory: string };
const coaData = coaDataRaw as unknown as Record<string, CoaAccount[]>;

export interface CoaLine { code: string; account: string; section: string; note?: string; include: boolean }

const INDUSTRY_MAP: Record<string, string> = {
  Retail: "Retail", "E-commerce": "E-commerce", SaaS: "SaaS", Technology: "SaaS",
  Restaurant: "Restaurant", Hospitality: "Hospitality", Trading: "Import export",
  "Import export": "Import export", Fintech: "Fintech",
  "Professional Services": "General COA", "Holding Company": "General COA", Other: "General COA",
};

function sectionOf(a: CoaAccount): string {
  const c = (a.category || "").toLowerCase();
  if (c.includes("asset")) return "Assets";
  if (c.includes("liabilit")) return "Liabilities";
  if (c.includes("equity")) return "Equity";
  if (c.includes("income") || c.includes("revenue")) return "Income";
  if (c.includes("cost of") || c.includes("cogs")) return "Cost of Goods";
  if (c.includes("expense")) return "Expenses";
  return "Other";
}

function parseJson(text: string): { rationale?: string; accounts?: CoaLine[] } | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

import type { AiFeature } from "@/lib/ai-config";

const TEXT_FEATURE_PROMPT: Record<string, { feature: AiFeature; instruction: string }> = {
  agenda: { feature: "agenda", instruction:
`Write a kickoff-call WELCOME + AGENDA email from the Onboarding Facilitator (Munees) to the client.

Formatting rules (strict):
- Plain text email — no markdown asterisks/bold, no headers, no HTML.
- Greeting: "Hi [Client Name]" on its own line.
- Sign-off: "Munees" then "Onboarding Facilitator" then "Finanshels" on separate lines.
- Keep paragraphs short. Use a numbered list (1. 2. 3. 4. 5.) for the agenda — NOT emojis.

Template to follow EXACTLY (fill bracketed variables from the data provided):

Hi [Client Name]

Welcome to Finanshels. My name is Munees, and I'll be your onboarding facilitator — overseeing the full onboarding process and making sure your setup with us is smooth from day one.

Working alongside me is [Accounting Manager Name], who will be your dedicated Accounting Manager.

Please find the agenda for tomorrow's call below:

1. Introductions
   Meet your dedicated team and how we'll work together.

2. Overview of your business
   Understanding your operations, structure, and what matters most to you.

3. Compliance check
   Reviewing your free zone entity requirements, VAT, and Corporate Tax position.

4. How we'll communicate
   Tools, points of contact, reporting cadence, and turnaround expectations.

5. Next steps and timeline
   Agreeing on milestones and what happens after this call.

Before the call, it would help us a great deal if you could fill in this short intake form — no login required:
[INTAKE_FORM_URL]

If there's anything else you'd like to cover, just let me know and I'll add it to the agenda.

Looking forward to speaking with you tomorrow.

Warm regards,
Munees
Onboarding Facilitator
Finanshels

VARIABLES:
- [Client Name] → client's first name (use just the contact's first name; if only company name is available, use the company name).
- [Accounting Manager Name] → the AM's full name from the assigned team. If unknown, write "[Accounting Manager Name]" as an editable placeholder.
- [INTAKE_FORM_URL] → intake form URL when provided. If no URL is provided, OMIT the entire "Before the call ..." paragraph (do not output it or any placeholder).

Output the ready-to-send email body ONLY — no subject line, no preamble, no JSON, no markdown fences.` },
  ai: { feature: "mom", instruction: "Write the MINUTES OF THE MEETING as plain text — no greeting, no sign-off (the surrounding email already has those). Structure EXACTLY in this order, using these literal headings on their own line (no markdown, no bold, no #):\n\nWhat we covered\n<2-4 short sentences summarising the call>\n\nDecisions\n- <one decision per bullet; if none were made, write '- None recorded.'>\n\nAction items\n- <task> — <owner> · due <date or 'TBD'> (one bullet per item; if none, write '- None recorded.')\n\nNext steps\n- <one bullet per next step the team or client will take; if none, write '- None recorded.'>\n\nEvery section MUST appear, even if its body is 'None recorded.' Use only details present in the notes — do not invent owners, due dates, or commitments." },
  mom: { feature: "mom", instruction: "Write ONLY the minutes-of-meeting body. Do NOT write a 'Subject:' line, a 'Dear …' greeting, any opening pleasantry (e.g. 'I hope this finds you well', 'Below are the minutes…'), or any sign-off — these are all added by a surrounding template. Output PLAIN TEXT only: no markdown, no asterisks (**), no '#' headings. Base it STRICTLY on the meeting notes provided (the recording link is for the client's reference — you cannot watch it, so do not invent anything not in the notes). Structure with these short labelled sections, each label on its own line followed by its content: 'Meeting Overview'; 'Decisions'; 'Action Items' (each with owner and due date); 'Next Steps'; and a final line with the recording link. Professional, specific to this meeting, concise." },
  welcome_email: { feature: "welcome_email", instruction: "Write a warm, professional welcome email from the Finanshels account manager to the client after the kickoff call: thank them, confirm scope and timeline, note the COA review and next steps, sign off. Ready to send." },
  datareq: { feature: "agenda", instruction: "Write a clear, friendly PERIODIC DATA-REQUEST email to the client for the bookkeeping period. Greet the client by name. State the period this covers and the cadence — write '[monthly]' as an editable placeholder the team can change to weekly/quarterly. List exactly the items we need: bank statements (all accounts), payment-gateway settlement reports, sales invoices, vendor bills & expenses, and payroll/WPS details. Give a clear '[due date]' placeholder, mention they can upload via their portal, and a Finanshels sign-off. Ready to send; keep placeholders in square brackets so the team can adjust before sending." },
  report: { feature: "handover_summary", instruction: "Write a professional MONTHLY REPORT email to the client for the period. Greet by name, give a 2-3 sentence summary of the month's performance, then short labelled lines for Profit & Loss highlights, Balance Sheet position, and Cash Flow. Note the full reports are attached / in their Drive folder, invite questions, and a Finanshels sign-off. Use only figures the team provides — do not invent numbers; leave '[ ]' placeholders for any figure not given. Ready to send after the team fills the numbers." },
  deck: { feature: "handover_summary", instruction: "Write a short, branded client onboarding deck as slide-by-slide content (Slide title + 1-2 lines each): Welcome, Scope of service, Your team, Timeline & milestones, What we need from you, How we work. Client-ready." },
  brief: { feature: "brief", instruction: "Write a sharp internal pre-call brief: business overview, UAE regulatory points (VAT/CT/WPS), the 4-5 best questions to ask on the call, risk/complexity flags, and a COA template recommendation. Concise and specific." },

  // ── Catch-up (CATCHUP_RUN template) ───────────────────────────────────────
  // Each step's note tells the user what they're drafting; these prompts produce
  // ready-to-copy plain-text messages with [bracketed placeholders] where the team
  // must fill specifics before sending.
  catchup_missing: { feature: "agenda", instruction:
`Write a short, friendly INTERNAL message (to the team / client contact) listing what is MISSING for the catch-up engagement.

Formatting rules (strict):
- Plain text — no markdown, no emojis, no headings, no bold.
- Greeting: "Hi [Name]" on its own line.
- One short opening sentence: "We're starting the catch-up for [Client Name] and need the following before we proceed:".
- Then a SINGLE bulleted list (use '- ') in TWO sections, each section preceded by a single label line:
    Documents:
    - [list items the team has marked missing — Trade Licence, MOA, Bank statements (catch-up period), Sales invoices, Vendor bills, Contracts, Salary sheet, Tracker, etc. — use '[List missing documents here]' as a placeholder if the team hasn't specified]
    Access (via Zoho Vault):
    - [list missing access — FTA portal, Bank access, Payment gateway, Other — use '[List missing access here]' as a placeholder if not specified]
- Close with: "Could you share these at your earliest? Happy to jump on a quick call if easier." then a Finanshels sign-off.

Output the ready-to-send message body ONLY — no subject line, no preamble, no JSON.` },

  zoho_account: { feature: "agenda", instruction:
`Write a SHORT internal Slack / email message to Lohith asking him to create a Zoho account for the client.

Formatting rules:
- Plain text — no markdown.
- Greeting: "Hi Lohith,".
- One sentence: "Please create an account in Zoho for [Client Company Name]."
- Then on separate short lines:
    Multi-currency: [yes / no]
    Attached: Trade Licence and VAT certificate (if any)
- One closing line: "Let me know once the account is ready and share the login details so we can begin the catch-up. Thanks!"
- Sign off with first name only.

Output the message body ONLY.` },

  catchup_query: { feature: "agenda", instruction:
`Write a clear, friendly email to the client sharing the CATCH-UP QUERY SHEET (Google Sheet).

Formatting rules:
- Plain text, no markdown.
- Greeting: "Hi [Client Name],".
- One sentence summarising context: "As part of the catch-up for the period [Catch-up Period], we've gone through your bank statements and supporting documents — we've captured a small set of items where we need your input."
- One sentence with the sheet link placeholder: "Please review the queries here and add your responses directly in the sheet: [Google Sheet Link]"
- Mention: "Each row notes the transaction date, amount, and what we'd like clarified — adding any supporting reference (invoice / receipt / contract) helps us close the line."
- Close with: "We'll keep reconciling in parallel and reach out if more come up. Thanks!" plus a Finanshels sign-off.

Output the email body ONLY.` },

  catchup_followup: { feature: "agenda", instruction:
`Write a SHORT polite follow-up email to the client about the open queries in the catch-up Google Sheet.

Formatting rules:
- Plain text, no markdown.
- Greeting: "Hi [Client Name],".
- One sentence: "Following up on the catch-up query sheet we shared — a few items are still open and are blocking us from closing the books for [Catch-up Period]."
- One link line: "Sheet: [Google Sheet Link]"
- Optional one sentence: "If easier, I'm happy to jump on a 15-minute call to walk through them together."
- Close with a Finanshels sign-off.

Output the email body ONLY.` },

  catchup_review: { feature: "brief", instruction:
`Write a STRUCTURED INTERNAL QA REVIEW of the client's catch-up books across all 30 catch-up QA checkpoints. This is for the Team Lead to read before final sign-off — it is NOT sent to the client.

Formatting rules:
- Plain text, no markdown headers, no emojis.
- One line opening: "Catch-up QA Review — [Client Name] — [Catch-up Period]".
- Then THREE labelled blocks, each label on its own line:
    What looks good:
    - [bulleted observations supported by data the team provided; if no data is given for an area, leave a placeholder '[Data not shared with AI]']
    Open issues / risks:
    - [bulleted material issues across these 30 areas: Period Closure, Manual Journals, P&L vs last 6mo, P&L cost-centre, P&L ledger review line-by-line, Revenue cut-off, Expense cut-off & accruals, Balance Sheet vs last 6mo, Cash & Equivalents, Prepayments, Advances & Deposits, Inventory, AR ageing, AP ageing, Fixed Assets, Intangibles, Provisions, Loans & Inter-company, Suspense & Clearing, Equity & Owner, Cash Flow, Corporate Tax, VAT, Sales invoice sampling, Expense sampling, Partner Statement, Management Reports, Flux analysis, SOPs & working papers, Final QA]
    Items to confirm before sign-off:
    - [bulleted specific cross-checks the Team Lead should personally verify]
- Be honest where you have no data: write '[Not assessable — no data shared]' rather than inventing findings.

Output the review body ONLY.` },
};

/** Generates AI text for a run step (agenda, MoM, welcome email, deck, brief).
 *  `extraContext` is appended to the prompt for steps that require pre-flight input
 *  (e.g. missing-items list for catchup_missing, notes for catchup_query, etc.). */
export async function generateStepText(
  runId: string,
  actType: string,
  extraContext?: string,
): Promise<{ error?: string; text?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const cfg = TEXT_FEATURE_PROMPT[actType] ?? TEXT_FEATURE_PROMPT.agenda;
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("*").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };

  // Real team names (no placeholders like "[Account Manager]").
  const { data: teamRows } = await supabase
    .from("run_team")
    .select("role_in_run,team_members(full_name)")
    .eq("run_id", runId);
  const ROLE_NICE: Record<string, string> = { am: "Account Manager", senior: "Senior Accountant", junior: "Junior Accountant", team_lead: "Team Lead", ops_head: "Operations" };
  const team = (teamRows ?? [])
    .map((t: { role_in_run: string; team_members: { full_name: string } | { full_name: string }[] | null }) => {
      const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
      return tm ? `${ROLE_NICE[t.role_in_run] ?? t.role_in_run}: ${tm.full_name}` : null;
    })
    .filter(Boolean)
    .join("; ");

  // The "mom" step now produces the post-call WELCOME EMAIL: a saved template
  // (onboarding portal link + login steps + portal explainer) with the real minutes
  // of the meeting embedded. The minutes MUST be based on the real recording +
  // notes — never invented — and the portal link must already be dispatched.
  let meetingBlock = "";
  let portalUrl = "";
  if (cfg.feature === "mom") {
    const { data: callStep } = await supabase
      .from("run_steps")
      .select("payload,completed_at")
      .eq("run_id", runId)
      .not("payload->>recording", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const p = (callStep?.payload ?? {}) as { recording?: string; notes?: string };
    let notes = p.notes?.trim() ?? "";
    // No manual notes? Pull the transcript from Fathom using the recording link (or client name).
    if (!notes && (p.recording?.trim() || client.name)) {
      const f = await fetchFathomNotes(session.profile.org_id, { shareUrl: p.recording, clientName: client.name });
      if (f?.text) notes = f.text;
    }
    if (!p.recording?.trim() && !notes) {
      return { error: "Add the meeting recording link (we'll pull the notes from Fathom) or paste your notes on the call step first — minutes are written from the real meeting, not generated blank." };
    }
    meetingBlock = `\n\nThe meeting actually happened. Write the minutes ONLY from these real notes (do not add anything that isn't here):\nRecording: ${p.recording ?? "n/a"}\nNotes:\n${notes || "(no notes — keep the minutes minimal and ask the client to confirm details)"}`;

    // The welcome email's whole point is to deliver the portal link, so it must
    // be dispatched first.
    const { data: linkRow } = await supabase
      .from("magic_links")
      .select("token")
      .eq("run_id", runId)
      .eq("purpose", "portal")
      .maybeSingle();
    const token = linkRow?.token as string | undefined;
    if (!token) {
      return { error: "Dispatch the onboarding portal link first (the 'Send Magic Link' step). The welcome email includes that link." };
    }
    const base = (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")).replace(/\/$/, "");
    portalUrl = base ? `${base}/portal/${token}` : `/portal/${token}`;
  }

  // For the AGENDA WhatsApp, splice in an intake-form link the client can fill before the call.
  // Reuse an existing standalone intake link if one exists; otherwise mint one. Best-effort:
  // if anything fails, fall back to "no intake URL" and tell the prompt to omit that section.
  let intakeUrl = "";
  if (actType === "agenda") {
    const { data: existingLink } = await supabase
      .from("magic_links")
      .select("token,run_id")
      .eq("client_id", run.client_id)
      .eq("purpose", "intake")
      .or(`run_id.eq.${runId},run_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let token = existingLink?.token as string | undefined;
    if (!token) {
      try {
        const admin = createAdminClient();
        const newToken = crypto.randomBytes(24).toString("base64url");
        const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
        const { error: insErr } = await admin.from("magic_links").insert({
          org_id: session.profile.org_id,
          run_id: runId,
          client_id: run.client_id,
          email: client.primary_contact_email ?? "",
          token: newToken,
          purpose: "intake",
          expires_at: expires,
        });
        if (!insErr) token = newToken;
      } catch { /* swallow — agenda still works without the link */ }
    }
    if (token) {
      const base = (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")).replace(/\/$/, "");
      intakeUrl = base ? `${base}/intake/${token}` : `/intake/${token}`;
    }
  }

  const ctx =
    `Client: ${client.name}; owner ${client.owner_name ?? "n/a"}; industry ${client.industry}; entity ${client.entity_type}; ` +
    `VAT ${client.vat_registered}; CT ${client.ct_registered}; ` +
    `revenue channels ${(client.revenue_channels ?? []).join(", ") || "n/a"}; ` +
    `accounting software ${client.accounting_software ?? "n/a"}.` +
    (team ? ` Assigned team — ${team}.` : "");

  const agendaIntakeNote = actType === "agenda"
    ? (intakeUrl
        ? `\n\nIntake form URL to splice in (replace [INTAKE_FORM_URL]): ${intakeUrl}`
        : `\n\nNo intake URL available — OMIT the "Before we meet" section entirely.`)
    : "";

  const extraCtxBlock = extraContext?.trim() ? `\n\nAdditional context provided by the team:\n${extraContext.trim()}` : "";

  try {
    const text = await runAi(session.profile.org_id, cfg.feature, {
      runId,
      system: "You write for a UAE accounting firm (Finanshels). Output must be polished and ready to send AS-IS — NEVER use [placeholders], brackets, or 'insert X here'; use the real client and team names provided. If a needed detail isn't in the context, leave it out rather than inventing it. Professional, warm, concise.",
      prompt: `${cfg.instruction}\n\nUse these real details (do not invent beyond them):\n${ctx}${meetingBlock}${agendaIntakeNote}${extraCtxBlock}`,
    });
    // For the welcome-email step, drop the AI-drafted minutes into the saved
    // template with the client's real name, company and portal link filled in.
    if (cfg.feature === "mom") {
      return {
        text: renderWelcomeEmail({
          contactName: client.owner_name?.trim() || client.name,
          companyName: client.name,
          portalUrl,
          momBody: text,
        }),
      };
    }
    return { text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

/** AI-generates a workflow diagram (nodes) from a plain-language description. */
export async function generateDiagram(runId: string, brief: string): Promise<{ error?: string; nodes?: { id: string; label: string; type: string }[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!brief.trim()) return { error: "Describe the workflow first." };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You convert a described process into a linear workflow. Output ONLY a JSON array.",
      prompt: `Turn this process into a JSON array of nodes [{"label":"","type":"start|step|decision|end"}] in order. First node start, last node end, decisions where a yes/no branch occurs. Process: ${brief}`,
    });
    const s = out.indexOf("["), e = out.lastIndexOf("]");
    const arr = s >= 0 ? (JSON.parse(out.slice(s, e + 1)) as { label: string; type: string }[]) : [];
    return { nodes: arr.map((n, i) => ({ id: `n${i}_${Math.random().toString(36).slice(2, 6)}`, label: n.label, type: n.type || "step" })) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

function parseArray<T>(text: string): T[] {
  try {
    const s = text.indexOf("["), e = text.lastIndexOf("]");
    return s >= 0 ? (JSON.parse(text.slice(s, e + 1)) as T[]) : [];
  } catch { return []; }
}

/** AI-generates a UAE compliance calendar from the client's VAT/CT/WPS + entity. */
export async function generateCompliance(runId: string): Promise<{ error?: string; items?: { label: string; type: string; date: string; reminderDays?: number }[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: c } = await supabase.from("clients").select("name,vat_registered,ct_registered,entity_type,established_year").eq("id", run.client_id).maybeSingle();
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You are a UAE compliance expert. Output ONLY a JSON array.",
      prompt:
        `Generate a 12-month UAE compliance calendar as JSON array [{"label":"","type":"VAT|CT|WPS|Doc expiry|Other","date":"YYYY-MM-DD"}]. ` +
        `Rules: VAT quarterly returns due 28 days after each quarter-end; Corporate Tax return due 9 months after financial year-end; WPS monthly salary transfer; trade licence + establishment card annual renewals. ` +
        `Client: VAT ${c?.vat_registered ?? "?"}, CT ${c?.ct_registered ?? "?"}, entity ${c?.entity_type ?? "?"}, established ${c?.established_year ?? "?"}. Today is 2026-06. Return 6-10 upcoming items.`,
    });
    const items = (parseArray(out) as { label: string; type: string; date: string }[])
      .map((i) => ({ ...i, reminderDays: 30 }));
    return { items };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

/**
 * Builds the compliance calendar ONLY from the client's uploaded documents — reads each file
 * (Supabase Storage or the connected member's Drive) and extracts its real expiry/renewal date
 * via OpenAI. Returns empty:true (no invented data) when there are no documents or no dates found.
 */
export async function generateComplianceFromDocs(runId: string): Promise<{ error?: string; items?: { label: string; type: string; date: string; reminderDays?: number }[]; empty?: boolean; scanned?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  return _generateComplianceFromDocsImpl(session.profile.org_id, runId);
}

/**
 * Session-free version — same logic, but accepts an explicit orgId. Used by
 * the playbook-sweep cron + batch jobs that don't run inside a user session.
 * Callers MUST gate upstream (CRON_SECRET / masterAdminGate).
 */
export async function _generateComplianceFromDocsImpl(orgId: string, runId: string): Promise<{ error?: string; items?: { label: string; type: string; date: string; reminderDays?: number }[]; empty?: boolean; scanned?: number }> {
  const admin = createAdminClient();
  const { data: run } = await admin.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await admin.from("clients").select("name,vat_registered,ct_registered,entity_type").eq("id", run.client_id).maybeSingle();
  const clientName = client?.name ?? "Client";

  // A Google-connected run-team member, for reading the client's Drive folder. If
  // no one on the run team has Google connected (common for runs where only the
  // master admin is wired up), fall back to ANY Google-connected member in the
  // org — same pattern as createClientDriveFolder / shareDriveFolder.
  let driveMember: string | undefined;
  const { data: rt } = await admin.from("run_team").select("team_member_id").eq("run_id", runId);
  const ids = (rt ?? []).map((r) => r.team_member_id).filter(Boolean);
  if (ids.length) {
    const { data: conn } = await admin.from("member_connections").select("team_member_id").eq("provider", "google").eq("connected", true).in("team_member_id", ids).limit(1);
    driveMember = conn?.[0]?.team_member_id as string | undefined;
  }
  if (!driveMember) {
    const fallback = await getDriveCapableMemberId(orgId, runId);
    if (fallback) driveMember = fallback;
  }

  // Scan the client's Drive "Company Documents" folder (all files + sub-folders) PLUS any docs
  // uploaded via the portal. Prefer the folder id SAVED at client creation (drive_folders.tree.id)
  // — robust to folder renames — and fall back to matching by client name only if it's missing.
  const { data: driveFolder } = await admin.from("drive_folders").select("tree").eq("client_id", run.client_id).maybeSingle();
  const storedFolderId = (driveFolder?.tree as { id?: string } | null)?.id;
  const driveFiles = driveMember
    ? (storedFolderId ? await listDriveDocsByFolderId(driveMember, storedFolderId) : await listClientDriveDocs(driveMember, clientName))
    : [];
  const { data: docs } = await admin.from("documents").select("id,label,status,storage_path").eq("client_id", run.client_id).eq("status", "uploaded");
  const tableFiles = (docs ?? []).filter((d) => d.storage_path);

  if (driveFiles.length === 0 && tableFiles.length === 0) {
    return { empty: true, scanned: 0 };
  }
  const key = (await getAiConfig(orgId)).keys.openai;
  if (!key) return { error: "Add an OpenAI key in Settings to read the documents' expiry dates." };

  type DocExtract = { docType?: string; expiry?: string; incorporationDate?: string; vatFirstFiling?: string; ctFirstFiling?: string; issuingAuthority?: string };
  const extract = async (buf: Buffer, mime: string, label: string): Promise<DocExtract | null> => {
    try {
      const up = new FormData();
      up.append("purpose", "user_data");
      up.append("file", new File([new Uint8Array(buf)], label || "document", { type: mime || "application/octet-stream" }));
      const upRes = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: up });
      if (!upRes.ok) return null;
      const fileId = (await upRes.json()).id as string;
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          input: [{ role: "user", content: [
            { type: "input_text", text:
              `This is a UAE business/compliance document. Return ONLY JSON: ` +
              `{"docType":"e.g. Trade Licence / VAT certificate / Corporate Tax registration / Emirates ID / Tenancy / Insurance / Establishment Card",` +
              `"expiry":"YYYY-MM-DD or null","incorporationDate":"YYYY-MM-DD or null","vatFirstFiling":"YYYY-MM-DD or null","ctFirstFiling":"YYYY-MM-DD or null",` +
              `"issuingAuthority":"e.g. DED / DMCC / JAFZA / ADGM / IFZA / Sharjah FZ / RAK / Ajman / null"}. ` +
              `Rules: "expiry" = the document's expiry / renewal / valid-until date (e.g. the Trade Licence expiry). ` +
              `If this is a Trade Licence, "incorporationDate" = the company's incorporation / issue / registration date on it. ` +
              `"issuingAuthority" = the licensing authority / free zone / government body that ISSUED the trade licence or certificate (e.g. DED for mainland Dubai, DMCC for DMCC FZ, JAFZA, ADGM, IFZA, Sharjah Media City, RAK ICC). Only set for Trade Licence / incorporation documents; null otherwise. ` +
              `If this is a VAT registration / TRN certificate, "vatFirstFiling" = the first VAT return filing/due date (or, if not stated, the effective date of VAT registration). ` +
              `If this is a Corporate Tax registration / certificate, "ctFirstFiling" = the first CT return filing/due date (or, if not stated, the CT registration/effective date). ` +
              `Use null for any field not present in THIS document. Dates strictly as YYYY-MM-DD.` },
            { type: "input_file", file_id: fileId },
          ] }],
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const text: string = j.output_text ?? ((j.output ?? []).flatMap((o: { content?: { text?: string }[] }) => (o.content ?? []).map((c) => c.text)).filter(Boolean).join("\n"));
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      return s >= 0 ? (JSON.parse(text.slice(s, e + 1)) as DocExtract) : null;
    } catch { return null; }
  };

  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const items: { label: string; type: string; date: string; reminderDays?: number }[] = [];
  const seen = new Set<string>();
  // Registration facts captured across the scanned documents (first non-null wins).
  const reg: { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string; tradeLicenceAuthority?: string } = {};
  let scanned = 0;
  // 30-day default reminder window — user's locked policy ("one month before").
  const REMINDER_DAYS = 30;
  const pushItem = (label: string, type: string, date: string) => {
    if (!seen.has(label)) { seen.add(label); items.push({ label, type, date, reminderDays: REMINDER_DAYS }); }
  };
  const add = (parsed: DocExtract | null, fallbackLabel: string) => {
    if (!parsed) return;
    const isTradeLicence = /trade\s*licen|commercial\s*licen|licence|license/i.test(parsed.docType ?? "");
    // Trade Licence → incorporation date + renewal/expiry + issuing authority.
    if (isDate(parsed.incorporationDate)) {
      reg.incorporationDate ??= parsed.incorporationDate;
      pushItem("Company incorporation date", "Trade Licence", parsed.incorporationDate);
    }
    if (isDate(parsed.expiry)) {
      if (isTradeLicence) reg.tradeLicenceExpiry ??= parsed.expiry;
      pushItem(`${parsed.docType || fallbackLabel} — renewal/expiry`, "Doc expiry", parsed.expiry);
    }
    if (isTradeLicence && parsed.issuingAuthority && parsed.issuingAuthority !== "null") {
      reg.tradeLicenceAuthority ??= parsed.issuingAuthority;
    }
    // VAT / CT → first filing dates.
    if (isDate(parsed.vatFirstFiling)) {
      reg.vatFirstFiling ??= parsed.vatFirstFiling;
      pushItem("VAT — first filing date", "VAT", parsed.vatFirstFiling);
    }
    if (isDate(parsed.ctFirstFiling)) {
      reg.ctFirstFiling ??= parsed.ctFirstFiling;
      pushItem("Corporate Tax — first filing date", "CT", parsed.ctFirstFiling);
    }
  };

  // 1) Drive "Company Documents" files
  for (const f of driveFiles) {
    if ((f.mimeType ?? "").includes("folder") || !driveMember) continue;
    const buf = await downloadDriveFile(driveMember, f.id);
    if (!buf) continue;
    scanned++;
    add(await extract(buf, f.mimeType, f.name), f.name);
  }
  // 2) Portal-uploaded documents
  for (const d of tableFiles) {
    const sp = d.storage_path as string;
    let buf: Buffer | null = null;
    let mime = "application/octet-stream";
    if (/^https?:\/\//.test(sp)) {
      const fid = driveFileIdFromLink(sp);
      if (fid && driveMember) buf = await downloadDriveFile(driveMember, fid);
    } else {
      const { data: blob } = await admin.storage.from("client-docs").download(sp);
      if (blob) { buf = Buffer.from(await blob.arrayBuffer()); mime = blob.type || mime; }
    }
    if (!buf) continue;
    scanned++;
    add(await extract(buf, mime, d.label), d.label);
  }

  // Persist the registration facts onto the client (merged with any existing) so the playbook
  // Compliance tab and the onboarding deck show the real dates without re-reading the files.
  // Also persist the issuing authority to the dedicated column so the clients table and
  // playbook can surface it without re-reading reg_facts.
  if (Object.keys(reg).length) {
    const { data: cur } = await admin.from("clients").select("reg_facts").eq("id", run.client_id).maybeSingle();
    const { tradeLicenceAuthority, ...regFacts } = reg;
    const merged = { ...((cur?.reg_facts as Record<string, string> | null) ?? {}), ...regFacts };
    const updatePayload: Record<string, unknown> = { reg_facts: merged };
    if (tradeLicenceAuthority) updatePayload.trade_licence_authority = tradeLicenceAuthority;
    await admin.from("clients").update(updatePayload).eq("id", run.client_id);
  }

  // ── Statutory recurring deadlines (deterministic, no AI) ──
  // Always appended when the client has VAT / CT obligations, so the team
  // never has to remember to also click "Add statutory dates". Sources, in
  // order: extracted reg facts (vatFirstFiling / ctFirstFiling) → client
  // toggle (vat_registered / ct_registered) → entity type heuristic.
  const today = new Date();
  const todayMs = today.getTime();
  const DAY = 86_400_000;
  const within18Months = (d: Date) => (d.getTime() - todayMs) / DAY < 18 * 30 && d.getTime() > todayMs - 90 * DAY;
  const toIso = (d: Date) => d.toISOString().slice(0, 10);

  // Helper: format a quarter label like "Q3 2026" given the quarter-end Date.
  const qLabel = (qEnd: Date) => `Q${Math.floor(qEnd.getUTCMonth() / 3) + 1} ${qEnd.getUTCFullYear()}`;

  // ── VAT quarterly returns ── due 28 days after each quarter-end.
  // Seed sequence from extracted vatFirstFiling, otherwise from "next calendar
  // quarter end" if the client is VAT-registered.
  const vatActive = !!reg.vatFirstFiling
    || /^(yes|true|registered)$/i.test(String(client?.vat_registered ?? ""));
  if (vatActive) {
    let cursor: Date;
    if (isDate(reg.vatFirstFiling)) {
      cursor = new Date(reg.vatFirstFiling + "T00:00:00Z");
    } else {
      // Default to the end of the current calendar quarter + 28 days.
      const m = today.getUTCMonth();
      const qEndMonth = m - (m % 3) + 2; // 2, 5, 8, 11
      const qEnd = new Date(Date.UTC(today.getUTCFullYear(), qEndMonth + 1, 0));
      cursor = new Date(qEnd.getTime() + 28 * DAY);
    }
    // Walk forward 4 quarters from the first upcoming filing.
    while (cursor.getTime() < todayMs) cursor = new Date(cursor.getTime() + 91 * DAY); // ~one quarter
    for (let i = 0; i < 4; i++) {
      const filing = new Date(cursor.getTime() + i * 91 * DAY);
      if (!within18Months(filing)) continue;
      // The quarter-end is ~28 days before the filing date.
      const qEnd = new Date(filing.getTime() - 28 * DAY);
      pushItem(`VAT return — ${qLabel(qEnd)} (due 28 days after quarter end)`, "VAT", toIso(filing));
    }
  }

  // ── Corporate Tax annual return ── due 9 months after the financial year-end.
  // Seed from extracted ctFirstFiling, otherwise compute from the next 31-Dec
  // year-end if the client is CT-registered (UAE default; users can edit).
  const ctActive = !!reg.ctFirstFiling
    || /^(yes|true|registered)$/i.test(String(client?.ct_registered ?? ""));
  if (ctActive) {
    let firstFiling: Date;
    if (isDate(reg.ctFirstFiling)) {
      firstFiling = new Date(reg.ctFirstFiling + "T00:00:00Z");
    } else {
      // Year-end = 31 Dec of the current or next year; CT due 30 Sep the following year.
      const y = today.getUTCMonth() >= 9 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
      firstFiling = new Date(Date.UTC(y, 8, 30)); // 30 Sep
    }
    if (within18Months(firstFiling)) {
      pushItem(`Corporate Tax annual return — due ${toIso(firstFiling)}`, "CT", toIso(firstFiling));
    }
    // Also surface the following year so the team has line-of-sight.
    const nextYearFiling = new Date(Date.UTC(firstFiling.getUTCFullYear() + 1, firstFiling.getUTCMonth(), firstFiling.getUTCDate()));
    if (within18Months(nextYearFiling)) {
      pushItem(`Corporate Tax annual return — due ${toIso(nextYearFiling)}`, "CT", toIso(nextYearFiling));
    }
  }

  return { items, empty: items.length === 0, scanned };
}

/** AI-generates internal projects + tasks from a plain-language brief over a period. */
export async function generateProjects(
  runId: string, instructions: string, periodStart: string, periodEnd: string, cadence: string,
): Promise<{ error?: string; items?: { name: string; month: string; tasks: string }[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: c } = await supabase.from("clients").select("industry").eq("id", run.client_id).maybeSingle();
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You plan recurring accounting delivery work. Output ONLY a JSON array. Base tasks on the instruction and industry — do not invent client-specific names or numbers.",
      prompt:
        `Create the FIRST month's delivery project with its tasks as a JSON array with ONE object [{"name":"","month":"${periodStart}","tasks":"task1; task2; task3"}]. ` +
        `Only one month — the team will duplicate it across the rest of the period (${periodStart} to ${periodEnd}, ${cadence} cadence). ` +
        `Industry: ${c?.industry ?? "general"}. Instruction: ${instructions || "standard monthly bookkeeping, VAT, payroll, reporting"}.`,
    });
    return { items: parseArray(out) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

/** Parses a plain-language list of recurring tasks into structured rows.
    e.g. "document request monthly 5th, bills daily, salary monthly 25th, sync meeting Thursday" */
export async function generateRecurringTasks(
  runId: string, text: string,
): Promise<{ error?: string; items?: { task: string; cadence: string; when: string }[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!text.trim()) return { error: "Describe the tasks first." };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You convert a plain-language list of recurring delivery tasks into structured JSON. Output ONLY a JSON array. Do not invent tasks the user did not mention.",
      prompt:
        `Parse this into a JSON array [{"task":"","cadence":"daily|weekly|biweekly|monthly","when":""}]. ` +
        `Rules: "when" = day-of-month for monthly (e.g. "5th", "25th"), day-of-week for weekly/biweekly (e.g. "Thursday"), empty "" for daily. ` +
        `If a cadence isn't stated, infer the most sensible one. Keep task names short. ` +
        `Tasks: ${text.trim()}`,
    });
    const arr = parseArray(out) as { task?: string; cadence?: string; when?: string }[];
    return { items: arr.map((i) => ({ task: String(i.task ?? ""), cadence: String(i.cadence ?? "monthly").toLowerCase(), when: String(i.when ?? "") })).filter((i) => i.task) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

export interface Deliverable { item: string; frequency: string; deadline: string }
export interface ContractAnalysis {
  periodStart?: string; // YYYY-MM
  periodEnd?: string;
  scope?: string;
  inclusions?: string[];
  exclusions?: string[];
  paymentTerms?: string;
  reportingFrequency?: "Monthly" | "Quarterly" | "Annual" | null; // answer to "How often would you like your financial reports delivered?"
  deliverables?: Deliverable[]; // what we deliver + when (defaults applied, team-editable)
}

/** Finanshels standard delivery cadence (UAE), gated by the contract-stated reporting
 *  frequency. Management-report + bookkeeping cadence MATCHES the client's answer to
 *  "How often would you like your financial reports delivered?" (Monthly / Quarterly / Annual).
 *  VAT and CT stay on their statutory cadence regardless. */
function defaultDeliverablesFor(freq: ContractAnalysis["reportingFrequency"] | undefined): Deliverable[] {
  const cadence = freq === "Quarterly"
    ? { label: "Quarterly", deadline: "Within 15 days of quarter end" }
    : freq === "Annual"
      ? { label: "Annual", deadline: "Within 30 days of financial year end" }
      : { label: "Monthly", deadline: "By the 15th of the following month" }; // default = monthly
  return [
    { item: `${cadence.label} management reports (P&L, balance sheet, cash flow)`, frequency: cadence.label, deadline: cadence.deadline },
    { item: "Bookkeeping & reconciliations", frequency: cadence.label, deadline: cadence.deadline },
    { item: "VAT return preparation & submission", frequency: "Quarterly", deadline: "Within 28 days of quarter end" },
    { item: "Corporate Tax return", frequency: "Annual", deadline: "Within 9 months of financial year end" },
  ];
}

/** AI-extracts scope / period / inclusions / exclusions / payment terms / deliverables from a pasted engagement contract. */
function isEmptyContract(c: ContractAnalysis): boolean {
  return !c.scope?.trim() && (!c.inclusions || c.inclusions.length === 0) && !c.paymentTerms?.trim();
}

const CONTRACT_PROMPT = (text: string) =>
  `Extract the engagement terms from this UAE accounting contract / proposal. ` +
  `Return ONLY JSON: {"periodStart":"YYYY-MM or null","periodEnd":"YYYY-MM or null","scope":"1-2 sentence summary of what we'll do for the client","inclusions":["every service/deliverable INCLUDED — one per line"],"exclusions":["every item OUT OF SCOPE — one per line"],"paymentTerms":"all pricing, billing cycle, taxes, refund rules combined into one paragraph","reportingFrequency":"Monthly|Quarterly|Annual or null","deliverables":[{"item":"the report/service","frequency":"Monthly|Quarterly|Annual|One-off","deadline":"plain-English due date"}]}. ` +
  `IMPORTANT — reportingFrequency: look inside scope/inclusions/proposal for the question "How often would you like your financial reports delivered?" (or any equivalent phrasing — "reporting cadence", "frequency of reports", "delivery of financial statements"). The client's answer is "Monthly", "Quarterly", or "Annual". If you can find it, set reportingFrequency to that exact value. If not stated, default to "Monthly". ` +
  `For deliverables: align the management-report + bookkeeping cadence WITH reportingFrequency (Monthly → monthly deliverables only; Quarterly → quarterly deliverables only; Annual → annual deliverables only). VAT stays Quarterly and CT stays Annual regardless (statutory). If the contract names a timeline use it exactly. Otherwise apply Finanshels UAE defaults: monthly reports by the 15th of the FOLLOWING month, quarterly reports within 15 days of quarter-end, annual reports within 30 days of year-end; VAT within 28 days of quarter-end; CT within 9 months of year-end. ` +
  `For periodStart/periodEnd: convert "12 months from 1 Jan 2026" style wording into actual months. If the engagement is ongoing / auto-renewing / "until terminated" / no end stated, set periodEnd to null. ` +
  `BE THOROUGH — read the WHOLE document, not just the first page. Pull every billable item, every exclusion. If a section is genuinely missing from the contract, use null or an empty array for that field — never leave required keys out.\n\nContract:\n${text.slice(0, 60000)}`;

/**
 * Parse JSON out of an LLM response. Tolerates markdown fences and trailing prose.
 * Returns null if no valid JSON object can be extracted.
 */
function parseContractJson(raw: string): ContractAnalysis | null {
  if (!raw) return null;
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{"), end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)) as ContractAnalysis; } catch { return null; }
}

export async function analyzeContract(runId: string, text: string): Promise<{ error?: string; result?: ContractAnalysis }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!text.trim()) return { error: "Paste the contract text first." };
  if (text.trim().length < 80)
    return { error: "The extracted text is too short — looks like a scanned PDF. Paste the contract text manually, or upload a non-scanned version." };

  const cfg = await getAiConfig(session.profile.org_id);
  const key = cfg.keys.openai;
  // Direct OpenAI chat-completion call with response_format: json_object — far more
  // reliable than the previous runAi(handover_summary) path, which was returning
  // empty-shaped results when the model wandered off the JSON track.
  if (key) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          response_format: { type: "json_object" },
          temperature: 0.1,
          messages: [
            { role: "system", content: "You extract structured data from UAE accounting engagement contracts. Output ONLY JSON with the requested schema. Be thorough — extract every inclusion, exclusion, and payment detail in the document." },
            { role: "user", content: CONTRACT_PROMPT(text) },
          ],
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        return { error: `OpenAI rejected the request (${r.status}): ${body.slice(0, 180)}` };
      }
      const j = await r.json();
      const out: string = j.choices?.[0]?.message?.content ?? "";
      const parsed = parseContractJson(out);
      if (!parsed) return { error: `The AI didn't return parseable JSON. Try again or paste the text manually. (Got: ${out.slice(0, 80)}…)` };
      if (isEmptyContract(parsed)) return { error: "The AI couldn't find any engagement terms in the text. Either the file isn't the contract, or only part of it was extracted. Paste the relevant section." };
      if (!parsed.deliverables || parsed.deliverables.length === 0) parsed.deliverables = defaultDeliverablesFor(parsed.reportingFrequency);
      return { result: parsed };
    } catch (e) {
      return { error: e instanceof Error ? `Couldn't reach OpenAI: ${e.message}` : "AI failed" };
    }
  }
  // Fallback to the multi-provider runAi if no OpenAI key (Claude/Gemini path).
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You extract structured data from UAE accounting engagement contracts. Output ONLY JSON.",
      prompt: CONTRACT_PROMPT(text),
    });
    const parsed = parseContractJson(out);
    if (!parsed) return { error: "AI didn't return parseable JSON. Add an OpenAI key in Settings for the most reliable contract analysis." };
    if (isEmptyContract(parsed)) return { error: "AI couldn't find engagement terms in the text. Paste the relevant contract section." };
    if (!parsed.deliverables || parsed.deliverables.length === 0) parsed.deliverables = defaultDeliverablesFor(parsed.reportingFrequency);
    return { result: parsed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

const CONTRACT_JSON_INSTRUCTION =
  `Read this UAE accounting engagement contract and return ONLY JSON: ` +
  `{"periodStart":"YYYY-MM","periodEnd":"YYYY-MM","scope":"1-2 sentence summary","inclusions":["..."],"exclusions":["..."],"paymentTerms":"...","reportingFrequency":"Monthly|Quarterly|Annual or null","deliverables":[{"item":"...","frequency":"Monthly|Quarterly|Annual|One-off","deadline":"plain-English due date"}]}. ` +
  `IMPORTANT — reportingFrequency: look inside scope/inclusions for the question "How often would you like your financial reports delivered?" (or equivalent phrasing — "reporting cadence", "frequency of reports", "delivery of financial statements"). The client's answer is "Monthly", "Quarterly", or "Annual". If found, set reportingFrequency to that value; if not stated, default to "Monthly". ` +
  `For "deliverables", list every report/service we must deliver and WHEN. The management-report + bookkeeping cadence MUST match reportingFrequency (Monthly → monthly; Quarterly → quarterly; Annual → annual). VAT stays Quarterly and CT stays Annual regardless (statutory). If the contract names a timeline use it exactly; otherwise apply Finanshels UAE defaults (monthly reports by the 15th of the following month; quarterly within 15 days of quarter-end; annual within 30 days of year-end; VAT within 28 days of quarter-end; CT within 9 months of year-end). ` +
  `periodStart/periodEnd are the engagement period as "YYYY-MM" (convert phrasing like "12 months from 1 Jan 2026" into actual start/end months). If the engagement has NO fixed end date — ongoing, auto-renewing, "until terminated", or no end stated — set periodEnd to null (shown as "onwards"). If a field is unknown use null/empty.`;

/**
 * Analyse a contract from the UPLOADED FILE (PDF, etc.) — no pasted text needed.
 * Uses OpenAI's native file understanding (the org's OpenAI key). Falls back with a clear
 * message if no OpenAI key is configured (the team can still paste text).
 */
/** Helper: call OpenAI's Responses API with a file (by file_id or inline base64) + a JSON instruction. */
async function callOpenAiResponsesWithFile(
  key: string,
  model: string,
  fileRef: { file_id: string } | { filename: string; file_data: string },
  instruction: string,
): Promise<{ error?: string; text?: string }> {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      // Put the file BEFORE the instruction — matches OpenAI's own cookbook and gives
      // the model the document context before asking it to act on it.
      input: [{ role: "user", content: [{ type: "input_file", ...fileRef }, { type: "input_text", text: instruction }] }],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    return { error: `OpenAI ${r.status}: ${body.slice(0, 200)}` };
  }
  const j = await r.json();
  const fromOutput = ((j.output ?? []) as { content?: { type?: string; text?: string }[] }[])
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text)
    .filter(Boolean)
    .join("\n");
  const text: string = (j.output_text as string | undefined) ?? fromOutput ?? "";
  return { text };
}

const CONTRACT_FILE_INSTRUCTION =
  `You are reading an attached UAE accounting engagement proposal/contract (PDF). ` +
  `The PDF contains the contract — read every page and extract the engagement terms. ` +
  `Do NOT respond with "I can't read this" — the file is attached above and you have access to its contents. ` +
  CONTRACT_JSON_INSTRUCTION;

export async function analyzeContractFile(runId: string, formData: FormData): Promise<{ error?: string; result?: ContractAnalysis }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  const cfg = await getAiConfig(session.profile.org_id);
  const key = cfg.keys.openai;
  if (!key) return { error: "Add an OpenAI key in Settings to read files automatically, or paste the contract text." };
  try {
    // Strategy A — inline base64 (no Files API round-trip; the PDF is in the request).
    // This is the more reliable path: it avoids file-state issues and matches how the
    // OpenAI cookbook demonstrates passing PDFs directly to the Responses API.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let base64 = "";
    // chunk to avoid blowing the call stack on String.fromCharCode for big PDFs
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    base64 = Buffer.from(base64, "binary").toString("base64");
    const dataUrl = `data:application/pdf;base64,${base64}`;

    const attempts: { label: string; model: string; fileRef: { file_id: string } | { filename: string; file_data: string } }[] = [
      { label: "inline gpt-4o", model: "gpt-4o", fileRef: { filename: file.name, file_data: dataUrl } },
      { label: "inline gpt-4.1", model: "gpt-4.1", fileRef: { filename: file.name, file_data: dataUrl } },
    ];

    // Strategy B — upload via Files API then reference by file_id. Used as a last resort
    // if the inline path returns a refusal/empty result.
    let fileId: string | null = null;
    try {
      const up = new FormData();
      up.append("purpose", "user_data");
      up.append("file", file);
      const upRes = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: up });
      if (upRes.ok) {
        fileId = (await upRes.json()).id as string;
        attempts.push({ label: "file_id gpt-4o", model: "gpt-4o", fileRef: { file_id: fileId } });
      }
    } catch { /* upload optional */ }

    const errors: string[] = [];
    for (const a of attempts) {
      const { error, text } = await callOpenAiResponsesWithFile(key, a.model, a.fileRef, CONTRACT_FILE_INSTRUCTION);
      if (error) { errors.push(`${a.label}: ${error}`); continue; }
      if (!text) { errors.push(`${a.label}: empty response`); continue; }
      const parsed = parseContractJson(text);
      if (!parsed) {
        // The model usually refuses in natural language — capture that for the user.
        errors.push(`${a.label}: ${text.slice(0, 160)}`);
        continue;
      }
      if (isEmptyContract(parsed)) { errors.push(`${a.label}: no terms found`); continue; }
      if (!parsed.deliverables || parsed.deliverables.length === 0) parsed.deliverables = defaultDeliverablesFor(parsed.reportingFrequency);
      return { result: parsed };
    }
    return { error: `Couldn't extract the contract from the file. Paste the contract text instead. Details: ${errors.join(" | ").slice(0, 360)}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI failed" };
  }
}

/** AI-researches the client from email domain + industry → client-facing description. */
export async function generateBusinessDescription(runId: string): Promise<{ error?: string; text?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name,industry,entity_type,primary_contact_email,revenue_channels").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };
  const rawDomain = (client.primary_contact_email ?? "").split("@")[1]?.trim().toLowerCase() ?? "";
  const GENERIC_MAILBOXES = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);
  const domainUsable = rawDomain && !GENERIC_MAILBOXES.has(rawDomain);
  const researchAnchor = domainUsable
    ? `Primary research signal: the business website is at the domain "${rawDomain}". Anchor your reasoning on that domain/brand FIRST. The company's registered name "${client.name}" is a secondary signal — domain is more reliable because UAE legal names often differ from trading names.`
    : `No business domain available (email is on a generic mailbox or empty). Reason from the company name "${client.name}" and the industry. If the name + industry don't give enough to write a confident description, say so plainly in 1-2 sentences and ask the client to confirm — DO NOT invent specifics.`;
  try {
    const text = await runAi(session.profile.org_id, "brief", {
      runId,
      system: "You profile UAE businesses for an accounting firm's onboarding. Write a confident, client-facing business description in 3-5 sentences that covers: (1) WHAT the business does, (2) HOW it makes money (its revenue model / main revenue streams), (3) WHO its customers are, and (4) how it positions itself in the market. Describe ONLY the client's own business — never mention our firm, Finanshels, or accounting services. Prefer the business domain as your research anchor when one is available; fall back to the company name only when the domain is missing or generic. Never invent specific figures or named contracts.",
      prompt: `${researchAnchor}\n\nIndustry: ${client.industry ?? "unknown"}. Entity: ${client.entity_type ?? "unknown"}. Revenue channels on file: ${(client.revenue_channels ?? []).join(", ") || "n/a"}.\n\nWrite the business description — what they do, how they make money, their customers, and their positioning in the UAE market.`,
    });
    return { text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

export interface DeckData {
  clientName: string;
  mission: string;
  agenda: { num: string; label: string; desc: string }[];
  whatWeUnderstood: { summary: string; tags: string[]; points: { icon: string; title: string; desc: string }[] };
  compliance: { ct: string; vat: string; wps: string; tradeLicence: string };
  software: { recommendation: string; existing: string; plan: string };
  contract: { scope: string; highlights: string[]; exclusions: string[]; payment: string; duration: string; responsibilities: string; /** Parallel to highlights — true if the item was shared/committed by the sales team in the proposal. */ inclusionsShared?: boolean[] };
  nextSteps: { icon: string; title: string; desc: string }[];
  receivedDocs: string[];
  /** Real dates pulled from the client's uploaded documents (Trade Licence / VAT / CT). */
  registration: { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string };
}

/** Build (or load) the branded onboarding deck for the micro-team flow. Auto-filled
 *  from client data → intake form → contract; editable after. Persisted in run_items 'deck'. */
export async function generateDeck(runId: string, force = false): Promise<{ error?: string; deck?: DeckData }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };

  if (!force) {
    const { data: existing } = await supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "deck").maybeSingle();
    const d = existing?.data as DeckData | undefined;
    // Only reuse a cached deck if it actually has content — otherwise regenerate
    // (a previous failed generation could have saved an empty deck).
    if (d?.clientName && d.mission && d.whatWeUnderstood?.summary) return { deck: d };
  }

  const { data: client } = await supabase.from("clients").select("*").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };
  const [{ data: intake }, { data: contractRow }] = await Promise.all([
    supabase.from("intake_forms").select("submitted,prefilled").eq("run_id", runId).maybeSingle(),
    supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "contract").maybeSingle(),
  ]);
  const intakeData = (intake?.submitted ?? intake?.prefilled ?? {}) as Record<string, unknown>;
  const contract = (contractRow?.data ?? null) as Record<string, unknown> | null;
  const businessDesc =
    (intakeData.description as string) ||
    `${client.name} — ${client.industry ?? "business"} (${client.entity_type ?? "UAE entity"}). Revenue: ${(client.revenue_channels ?? []).join(", ") || "n/a"}.`;

  const system =
    "You are an onboarding consultant for Finanshels (UAE accounting & tax). Return ONLY valid JSON (no markdown). " +
    "Use the REAL details provided — never invent client names, figures or placeholder text. If a contract is given, use its real scope/terms; if a field is missing say 'Not specified'.";
  const prompt =
    `Client: ${client.name}. Industry: ${client.industry ?? "n/a"}. Entity: ${client.entity_type ?? "n/a"}. ` +
    `VAT: ${client.vat_registered ?? "?"}, CT: ${client.ct_registered ?? "?"}. Business: ${businessDesc}. ` +
    (contract ? `Contract details: ${JSON.stringify(contract).slice(0, 2500)}. ` : "No contract provided — base the contract section on the business, mark unknowns 'Not specified'. ") +
    `Return JSON: {"mission": "1-2 sentence welcome mission for this client", ` +
    `"agenda":[{"num":"01","label":"","desc":""} ... 6 items], ` +
    `"whatWeUnderstood":{"summary":"2 specific sentences about THIS business","tags":["3-5 short attributes"],"points":[{"icon":"emoji","title":"","desc":""} x4]}, ` +
    `"compliance":{"ct":"CT note specific to this client","vat":"VAT note","wps":"WPS note","tradeLicence":"trade licence note — that we track the licence renewal/expiry date and remind before it lapses"}, ` +
    `"software":{"recommendation":"why Zoho Books suits them","plan":"recommended Zoho Books subscription plan for this client — pick ONE of Standard / Professional / Premium and add a 4-8 word reason (e.g. 'Professional — multi-currency & purchase orders for trading')","existing":"one line on reviewing existing tools"}, ` +
    `"contract":{"scope":"","highlights":["what is INCLUDED in scope, 2-5 items"],"exclusions":["what is OUT of scope / not covered, 0-5 items"],"payment":"","duration":"","responsibilities":"what the CLIENT must do/provide (their responsibilities), not exclusions"}, ` +
    `"nextSteps":[{"icon":"emoji","title":"","desc":""} x3]}. ` +
    `IMPORTANT for nextSteps: the contract is ALREADY signed — do NOT include "sign the contract" or anything about signing. The next steps reflect what happens after this call: we share a welcome email with the secure client-portal link; the client uploads the required documents and grants system access from the portal; then we begin setup.`;

  let parsed: Partial<DeckData> & { mission?: string };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", { runId, system, prompt });
    const s = out.indexOf("{"), e = out.lastIndexOf("}");
    parsed = JSON.parse(out.slice(s, e + 1));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI failed. Check your AI key in Settings." };
  }

  // Documents already on file (e.g. collected by Sales before onboarding) — shown
  // in the deck so the team doesn't re-request what's already received.
  const { data: receivedRows } = await supabase
    .from("documents")
    .select("label,status")
    .eq("client_id", run.client_id)
    .eq("status", "uploaded");
  const { cleanDocLabels } = await import("@/lib/doc-labels");
  const receivedDocs = cleanDocLabels((receivedRows ?? []).map((d) => d.label as string).filter(Boolean));

  // Real registration dates extracted from the uploaded documents (Trade Licence / VAT / CT).
  const reg = (client.reg_facts as DeckData["registration"] | null) ?? {};
  const fmtD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

  const deck: DeckData = {
    clientName: client.name,
    mission: parsed.mission || "We're thrilled to have you on board. Our mission is to automate and strengthen your financial operations so you can focus on growth.",
    agenda: parsed.agenda?.length ? parsed.agenda : [
      { num: "01", label: "Introductions", desc: "Meet your Finanshels team" },
      { num: "02", label: "What We Understood", desc: "Our view of your business — confirm with us" },
      { num: "03", label: "Onboarding Roadmap", desc: "The 5-phase journey" },
      { num: "04", label: "Compliance Review", desc: "CT, VAT & WPS" },
      { num: "05", label: "Software Setup", desc: "Accounting platform" },
      { num: "06", label: "Next Steps", desc: "What happens after this call" },
    ],
    whatWeUnderstood: parsed.whatWeUnderstood ?? { summary: businessDesc, tags: [client.industry ?? "SME", "UAE-based"], points: [] },
    compliance: {
      ct: [parsed.compliance?.ct ?? "", fmtD(reg.ctFirstFiling) && `First CT filing: ${fmtD(reg.ctFirstFiling)}.`].filter(Boolean).join(" "),
      vat: [parsed.compliance?.vat ?? "", fmtD(reg.vatFirstFiling) && `First VAT filing: ${fmtD(reg.vatFirstFiling)}.`].filter(Boolean).join(" "),
      wps: parsed.compliance?.wps ?? "",
      tradeLicence: [parsed.compliance?.tradeLicence ?? "", fmtD(reg.incorporationDate) && `Incorporated ${fmtD(reg.incorporationDate)}.`, fmtD(reg.tradeLicenceExpiry) && `Licence expires ${fmtD(reg.tradeLicenceExpiry)}.`].filter(Boolean).join(" "),
    },
    software: { recommendation: parsed.software?.recommendation ?? "", existing: parsed.software?.existing ?? "", plan: parsed.software?.plan ?? "" },
    contract: parsed.contract ? { ...parsed.contract, exclusions: parsed.contract.exclusions ?? [] } : { scope: "", highlights: [], exclusions: [], payment: "", duration: "", responsibilities: "" },
    nextSteps: parsed.nextSteps?.length ? parsed.nextSteps : [
      { icon: "📧", title: "Welcome email & portal", desc: "We share your welcome email with a secure link to your onboarding portal." },
      { icon: "📂", title: "Documents & access", desc: "Upload any remaining documents and grant system access from the portal." },
      { icon: "🚀", title: "We begin setup", desc: "We configure your books, compliance calendar and reporting." },
    ],
    receivedDocs,
    registration: reg,
  };

  // "What we understood" must be the high-quality business description (gpt-4o), not the
  // deck prompt's thin summary. Prefer the client's own intake description if they gave one.
  try {
    const bd = await generateBusinessDescription(runId);
    const best = (intakeData.description as string)?.trim() || bd.text?.trim();
    if (best) deck.whatWeUnderstood = { ...deck.whatWeUnderstood, summary: best };
  } catch { /* keep the deck-prompt summary */ }

  // The deck's contract section must mirror the SAME analysis done at the magic-link step
  // (run_items kind 'contract'), not an AI re-interpretation. Override directly when present.
  if (contract) {
    const c = contract as { scope?: string; inclusions?: string[]; exclusions?: string[]; paymentTerms?: string; periodStart?: string; periodEnd?: string; deliverables?: { item: string }[] };
    const highlights = (c.inclusions?.length ? c.inclusions : (c.deliverables ?? []).map((d) => d.item)).filter(Boolean);
    deck.contract = {
      scope: c.scope || deck.contract.scope,
      highlights: highlights.length ? highlights : deck.contract.highlights,
      // Exclusions get their own field now (no longer jammed into responsibilities).
      exclusions: c.exclusions?.length ? c.exclusions : deck.contract.exclusions,
      payment: c.paymentTerms || deck.contract.payment,
      duration: (c.periodStart || c.periodEnd) ? formatEngagementPeriod(c.periodStart, c.periodEnd) : deck.contract.duration,
      // Keep the client's own responsibilities (from the deck prompt) distinct from exclusions.
      responsibilities: deck.contract.responsibilities,
    };
  }

  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "deck");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "deck", data: deck, status: "open" });
  return { deck };
}

/** Persist edits to the deck. */
export async function saveDeck(runId: string, deck: DeckData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "deck");
  await supabase.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "deck", data: deck, status: "open" });
  return {};
}

/** Saves AI text into the step payload and completes the step. */
export async function saveStepText(runId: string, stepId: string, text: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("template_key,group_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_steps").upsert(
    { run_id: runId, step_no: stepId, status: "complete", payload: { text }, completed_at: new Date().toISOString(), title: stepId, type: "ai" },
    { onConflict: "run_id,step_no" },
  );
  await completeStep(runId, stepId);

  // Group mirror: MoM, agenda and welcome email are deal-level artefacts —
  // one per group, not per entity. Copy to every sibling run's matching step.
  if (run.group_id) {
    const tpl = await (await import("@/lib/templates-store")).getTemplate(run.template_key);
    const sourceActType = tpl?.stages.flatMap((s) => s.steps).find((st) => st.id === stepId)?.act?.type;
    const MIRROR = new Set(["mom", "agenda", "welcome_email"]);
    if (sourceActType && MIRROR.has(sourceActType)) {
      const { data: sibs } = await supabase
        .from("onboarding_runs").select("id,template_key")
        .eq("group_id", run.group_id).neq("id", runId);
      const { getTemplate } = await import("@/lib/templates-store");
      for (const sib of sibs ?? []) {
        try {
          const sibTpl = await getTemplate(sib.template_key);
          const sibStep = sibTpl?.stages.flatMap((s) => s.steps).find((st) => st.act?.type === sourceActType);
          if (!sibStep) continue;
          await supabase.from("run_steps").upsert(
            { run_id: sib.id, step_no: sibStep.id, status: "complete", payload: { text }, completed_at: new Date().toISOString(), title: sibStep.id, type: "ai" },
            { onConflict: "run_id,step_no" },
          );
          await completeStep(sib.id, sibStep.id);
        } catch (e) {
          console.error("[group mirror saveStepText]", sourceActType, "→", sib.id, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return {};
}

/** AI-tailors the industry chart of accounts to this client. */
/** Extracts account / revenue / expense suggestions from the kickoff-call Fathom transcript for pre-population in the COA dialog. */
export async function getCallSuggestedAccounts(runId: string): Promise<{ suggestions: string[]; error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { suggestions: [], error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { suggestions: [] };
  const { data: client } = await supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle();

  // Find the kickoff call step (has a recording payload)
  const { data: callStep } = await supabase
    .from("run_steps")
    .select("payload")
    .eq("run_id", runId)
    .not("payload->>recording", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = (callStep?.payload ?? {}) as { recording?: string; notes?: string };
  let notes = p.notes?.trim() ?? "";
  if (!notes && (p.recording?.trim() || client?.name)) {
    const f = await fetchFathomNotes(session.profile.org_id, { shareUrl: p.recording, clientName: client?.name });
    if (f?.text) notes = f.text;
  }
  if (!notes) return { suggestions: [] };

  try {
    const aiText = await runAi(session.profile.org_id, "coa_suggestions", {
      runId,
      system: "You are a UAE accounting expert extracting chart-of-accounts items from a client kickoff call transcript.",
      prompt: `From this kickoff call transcript, extract all specific financial items mentioned that should become accounts in a chart of accounts. Include: revenue streams, expense categories, specific banks named, payment gateways mentioned, specific suppliers or cost types, asset categories, and any other financially relevant named items. Return ONLY a JSON array of short, clean strings — each is an account name or category. Maximum 20 items. No duplicates. Example: ["Sales - Online", "Bank - ADCB", "Stripe Gateway Clearing", "Salary Expense", "Office Rent"]\n\nTranscript:\n${notes.slice(0, 4000)}`,
    });
    const parsed = JSON.parse(aiText.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (Array.isArray(parsed)) return { suggestions: parsed.filter((s: unknown) => typeof s === "string").slice(0, 20) as string[] };
  } catch {
    // ignore AI failure — just return empty
  }
  return { suggestions: [] };
}

/** Same as getCallSuggestedAccounts but takes explicit notes text (for manual Fathom paste). */
export async function getCallSuggestedAccountsFromNotes(runId: string, notes: string): Promise<{ suggestions: string[]; error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { suggestions: [], error: "Not signed in." };
  if (!notes.trim()) return { suggestions: [] };
  try {
    const aiText = await runAi(session.profile.org_id, "coa_suggestions", {
      runId,
      system: "You are a UAE accounting expert extracting chart-of-accounts items from a client kickoff call transcript.",
      prompt: `From this kickoff call transcript, extract all specific financial items mentioned that should become accounts in a chart of accounts. Include: revenue streams, expense categories, specific banks named, payment gateways mentioned, specific suppliers or cost types, asset categories, and any other financially relevant named items. Return ONLY a JSON array of short, clean strings — each is an account name or category. Maximum 20 items. No duplicates. Example: ["Sales - Online", "Bank - ADCB", "Stripe Gateway Clearing", "Salary Expense", "Office Rent"]\n\nTranscript:\n${notes.slice(0, 4000)}`,
    });
    const parsed = JSON.parse(aiText.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (Array.isArray(parsed)) return { suggestions: parsed.filter((s: unknown) => typeof s === "string").slice(0, 20) as string[] };
  } catch {
    // ignore AI failure
  }
  return { suggestions: [] };
}

export async function generateCoa(
  runId: string,
  extraAccounts?: string[],
): Promise<{ error?: string; accounts?: CoaLine[]; rationale?: string; cogsRationale?: string; industry?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("*").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };

  // Pull the client's intake answers — every revenue/expense channel, bank and gateway
  // they gave us MUST appear as an account in the COA.
  const { data: intake } = await supabase.from("intake_forms").select("submitted,prefilled").eq("run_id", runId).maybeSingle();
  const intakeData = (intake?.submitted ?? intake?.prefilled ?? {}) as Record<string, unknown>;
  const asArr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
  const intakeRevenue = [...new Set([...asArr(intakeData.revenue), ...(client.revenue_channels ?? [])])];
  const intakeExpense = asArr(intakeData.expense);
  const intakeBanks = [...new Set([...asArr(intakeData.banks), ...(client.bank_names ?? [])])];
  const intakeGateways = [...new Set([...asArr(intakeData.gateways), ...(client.payment_gateways ?? [])])];

  const tplIndustry = INDUSTRY_MAP[client.industry as string] ?? "General COA";
  const accounts = coaData[tplIndustry] ?? coaData["General COA"];
  const mandatoryLines: CoaLine[] = accounts
    .filter((a) => /mandatory/i.test(a.tag))
    .map((a) => ({ code: a.code, account: a.account, section: sectionOf(a), include: true }));

  const extraNote = extraAccounts?.length
    ? `\n\nADDITIONAL accounts confirmed by the team from the kickoff call — include a dedicated account for EACH of these (they were explicitly discussed and confirmed): [${extraAccounts.join(", ")}].`
    : "";

  const prompt =
    `Client: ${client.name}; industry ${client.industry}; entity ${client.entity_type}; ` +
    `VAT ${client.vat_registered}; CT ${client.ct_registered}; ` +
    `revenue channels ${(client.revenue_channels ?? []).join(", ") || "n/a"}; ` +
    `payment gateways ${(client.payment_gateways ?? []).join(", ") || "n/a"}; ` +
    `accounting software ${client.accounting_software ?? "n/a"}.\n\n` +
    `Base "${tplIndustry}" chart of accounts (code | account | tag):\n` +
    accounts.map((a) => `${a.code} | ${a.account} | ${a.tag}`).join("\n") +
    `\n\nMUST-HAVE accounts from the client's intake form — create a dedicated account for EACH of these (they are confirmed by the client, so they must appear): ` +
    `revenue channels [${intakeRevenue.join(", ") || "none given"}]; expense channels [${intakeExpense.join(", ") || "none given"}]; ` +
    `banks [${intakeBanks.join(", ") || "none given"}] (each = a bank/cash account under Assets); payment gateways [${intakeGateways.join(", ") || "none given"}] (each = a gateway clearing account). ` +
    extraNote +
    `\n\nIMPORTANT — classify by the CLIENT'S OWN primary business activity, NOT the industry of their customers. ` +
    `Example: a marketing agency serving F&B clients is a marketing / professional-services business (service revenue, no inventory/COGS) — it is NOT an F&B business. ` +
    `If the client spans multiple activities, choose the broader fit and add accounts for each material revenue line. The base template above is only a starting point — adapt it to what this client actually does. ` +
    `\n\nCOST OF GOODS / GROSS PROFIT — this is critical. You MUST evaluate whether the client has direct costs of delivering revenue. ` +
    `Direct costs include: inventory purchased for resale, sub-contractor / freelancer fees billed against client work, hosting / SaaS resold to clients, ` +
    `materials, packaging, freight-in, payment-processor fees taken from gross sales, commissions paid on each sale, food cost (restaurants), ` +
    `medical consumables (clinics), course content licensing (e-learning), etc. ` +
    `If ANY of these apply, you MUST include them as "Cost of Goods" section accounts so Gross Profit can be calculated. ` +
    `Trading / retail / e-commerce / restaurant / manufacturing / construction / clinic / agency-with-subcontractors all have COGS. ` +
    `Only a PURE service business with no pass-through costs (e.g. a solo consultant billing only own time) has zero COGS. ` +
    `In your "cogsRationale" field, state explicitly which direct costs apply (and which lines you added) — or, if none apply, state precisely why. ` +
    `\n\nReturn ONLY a JSON object: {"industry":"the effective industry classification you used","rationale":"2-3 sentences on why this COA fits the client",` +
    `"cogsRationale":"1-2 sentences explaining the COGS decision (which direct costs apply, or why none apply)",` +
    `"accounts":[{"code":"","account":"","section":"","note":""}]}. ` +
    `Include every Mandatory account plus the optional ones relevant to this client's channels, gateways and VAT status. ` +
    `Add any client-specific accounts needed (e.g. payment-gateway clearing). ` +
    `"section" must be one of: Assets, Liabilities, Equity, Income, Cost of Goods, Expenses.`;

  let aiText: string;
  try {
    aiText = await runAi(session.profile.org_id, "coa", {
      runId,
      system: "You are a UAE chart-of-accounts expert for an accounting firm. Be precise and FTA-compliant. When the client's industry is ambiguous or cross-industry, classify by their OWN primary activity (the service they provide), use the closest broad category, and never force a niche template that doesn't fit.",
      prompt,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "AI failed",
      accounts: mandatoryLines,
      industry: tplIndustry,
      rationale: "AI unavailable — showing the mandatory accounts from the industry template.",
    };
  }

  const parsed = parseJson(aiText);
  if (!parsed?.accounts?.length) {
    return { accounts: mandatoryLines, rationale: aiText.slice(0, 500), industry: tplIndustry };
  }
  return {
    accounts: parsed.accounts.map((a) => ({ ...a, include: a.include !== false })),
    rationale: parsed.rationale ?? "",
    cogsRationale: (parsed as { cogsRationale?: string }).cogsRationale ?? "",
    industry: (parsed as { industry?: string }).industry || tplIndustry,
  };
}

/** Saves the tailored COA to the run and completes the COA step. */
/**
 * AI-extends the master tax codes for this client's industry — keeps the
 * UAE baseline + any overlay, then asks the model to add the industry-specific
 * RCM / zero-rated / exempt items the team would otherwise key in by hand.
 * Returns the merged list; the team then edits + saves.
 */
export async function generateTaxCodes(runId: string): Promise<{
  error?: string;
  industry?: string;
  codes?: { code: string; name: string; rate: number; kind: "standard" | "zero" | "exempt" | "rcm" | "out_of_scope"; notes?: string }[];
}> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase
    .from("clients")
    .select("name,industry,business_description,services,revenue_channels,bank_names,payment_gateways,accounting_software,vat_registered,ct_registered")
    .eq("id", run.client_id)
    .maybeSingle();
  if (!client) return { error: "Client not found." };

  const { defaultTaxCodesFor, ensureSeedTaxCodes } = await import("@/lib/tax-codes");
  await ensureSeedTaxCodes(session.profile.org_id);
  const { data: existingSet } = await supabase
    .from("tax_code_sets")
    .select("codes")
    .eq("org_id", session.profile.org_id)
    .eq("industry", client.industry ?? "UAE Baseline")
    .maybeSingle();
  const baseCodes = existingSet?.codes
    ? (existingSet.codes as { code: string; name: string; rate: number; kind: "standard" | "zero" | "exempt" | "rcm" | "out_of_scope"; notes?: string }[])
    : defaultTaxCodesFor(client.industry ?? "UAE Baseline");

  try {
    const out = await runAi(session.profile.org_id, "coa", {
      system:
        "You are a UAE tax adviser. Output ONLY JSON. Add industry-specific UAE VAT + Corporate Tax codes that the team would otherwise key in by hand for this client. Never invent rates not in UAE law — VAT is 5% / 0% / exempt / RCM 5% / out-of-scope; CT is 0% (sub-AED 375k / qualifying free zone) or 9%.",
      prompt:
        `Existing baseline tax codes for this client's industry — KEEP them:\n${JSON.stringify(baseCodes)}\n\n` +
        `Client context: ${client.name}; industry ${client.industry ?? "unknown"}; ` +
        `services ${(client.services ?? []).join(", ") || "n/a"}; ` +
        `revenue channels ${(client.revenue_channels ?? []).join(", ") || "n/a"}; ` +
        `banks ${(client.bank_names ?? []).join(", ") || "n/a"}; ` +
        `gateways ${(client.payment_gateways ?? []).join(", ") || "n/a"}; ` +
        `accounting software ${client.accounting_software ?? "n/a"}; ` +
        `VAT ${client.vat_registered ?? "?"}; CT ${client.ct_registered ?? "?"}. ` +
        `Business: ${client.business_description ?? "(not yet captured)"}.\n\n` +
        `Return JSON: {"codes":[{"code":"VAT-...","name":"...","rate":0|5|9,"kind":"standard|zero|exempt|rcm|out_of_scope","notes":"why it matters for this client"}]}. ` +
        `Include the baseline codes UNCHANGED, then add NEW codes specifically useful for this client (e.g. designated-zone supplies for free zones, qualifying healthcare/education zero-rated for those industries, marketplace RCM for e-commerce, related-party CT adjustments for holding companies). Maximum 20 codes total.`,
    });
    const s = out.indexOf("{"); const e = out.lastIndexOf("}");
    const parsed = s >= 0 ? JSON.parse(out.slice(s, e + 1)) as { codes?: { code: string; name: string; rate: number; kind: "standard" | "zero" | "exempt" | "rcm" | "out_of_scope"; notes?: string }[] } : {};
    const codes = Array.isArray(parsed.codes) && parsed.codes.length ? parsed.codes : baseCodes;
    return { industry: client.industry ?? "UAE Baseline", codes };
  } catch (err) {
    // AI failed — return the baseline so the modal still opens with something useful.
    return { industry: client.industry ?? "UAE Baseline", codes: baseCodes, error: err instanceof Error ? err.message : "AI failed (baseline returned)." };
  }
}

/** Save the team-finalised tax codes for this run + complete the step. */
export async function saveTaxCodes(
  runId: string,
  stepId: string,
  industry: string,
  codes: { code: string; name: string; rate: number; kind: "standard" | "zero" | "exempt" | "rcm" | "out_of_scope"; notes?: string }[],
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const cleaned = codes
    .filter((c) => c.code?.trim() && c.name?.trim())
    .map((c) => ({ code: c.code.trim(), name: c.name.trim(), rate: Number(c.rate) || 0, kind: c.kind, notes: c.notes?.trim() || undefined }));
  // Delete any existing tax_codes row for this run, then insert fresh.
  await supabase.from("run_items").delete().eq("run_id", runId).eq("kind", "tax_codes");
  const { error } = await supabase.from("run_items").insert(
    { run_id: runId, kind: "tax_codes", data: { industry, codes: cleaned }, sort: 0 },
  );
  if (error) return { error: error.message };
  await completeStep(runId, stepId);
  return {};
}

export async function saveCoa(
  runId: string,
  stepId: string,
  accounts: CoaLine[],
  rationale: string,
  industry: string,
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };

  // Was this COA already prepared/signed off? If so, saving again is an EDIT — notify the team.
  const { data: prior } = await supabase.from("coa_instances").select("status,client_signed_off").eq("run_id", runId).maybeSingle();
  const isEdit = !!prior && (prior.client_signed_off || prior.status === "sa_adjusted" || prior.status === "signed_off");

  const { error } = await supabase.from("coa_instances").upsert(
    {
      run_id: runId, client_id: run.client_id, base_industry: industry,
      accounts: accounts.filter((a) => a.include), ai_rationale: rationale, status: "sa_adjusted",
    },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };

  if (isEdit) {
    await supabase.from("notifications").insert({
      org_id: run.org_id, run_id: runId, kind: "info",
      title: "Chart of accounts edited",
      body: `${session.teamMember?.full_name ?? session.email} updated the chart of accounts after it was finalised.`,
    });
  } else {
    await completeStep(runId, stepId);
  }
  return {};
}

/** AI-generates a polished onboarding one-pager from the run's compliance calendar, contract,
 *  team and the client's UAE registration facts. Saves to run_items kind='onepager'. */
function buildWhatsAppMsg(opts: { ownerName: string; amName: string; amEmail: string; clientName: string; nextDeadline: string; docsCount: number; firstDelivery: string }): string {
  const { ownerName, amName, amEmail, clientName, nextDeadline, docsCount, firstDelivery } = opts;
  const greeting = ownerName ? `Hi ${ownerName.split(" ")[0]}` : "Hi";
  return [
    `${greeting}! I'm ${amName} from Finanshels — your Account Manager for ${clientName}.`,
    ``,
    `I've put together your onboarding summary. Here's what it covers:`,
    `✅ Your compliance calendar — key deadlines & renewals`,
    nextDeadline ? `📅 Next upcoming: ${nextDeadline}` : ``,
    docsCount > 0 ? `📁 ${docsCount} document(s) received and on file` : ``,
    firstDelivery ? `📊 First delivery: ${firstDelivery}` : ``,
    `👥 Your dedicated Finanshels team`,
    ``,
    `I'll send this across shortly. If you have any questions or need to share additional documents, feel free to reply here or email me at ${amEmail}.`,
    ``,
    `Looking forward to working with you!`,
  ].filter((l) => l !== undefined && !(l === `` && false)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function generateOnePager(runId: string): Promise<{ error?: string; data?: { generated: string; sections?: { heading: string; items: string[] }[]; generatedAt: string; whatsappMsg?: string } }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };

  const { data: client } = await supabase.from("clients").select("name,owner_name,industry,reg_facts,vat_registered,ct_registered,entity_type").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };

  // Compliance calendar items — deduplicated and cleaned
  const { data: compRows } = await supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "compliance");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rawComp = (compRows ?? []).map((r) => r.data as { label?: string; type?: string; date?: string | null; reminderDays?: number });
  // Remove past dates (except TBC items with null date)
  const futureComp = rawComp.filter((x) => {
    if (!x.date) return true; // null = TBC, keep
    return new Date(x.date) >= today;
  });
  // WPS: keep only the single soonest occurrence, mark as recurring
  const wpsItems = futureComp.filter((x) => x.type === "WPS" || (x.label ?? "").toLowerCase().includes("wps")).sort((a, b) => (a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1);
  const wpsNext = wpsItems[0] ? { ...wpsItems[0], label: "WPS Monthly Salary Transfer", _recurring: true } : null;
  // Non-WPS: dedupe by label+date
  const seen = new Set<string>();
  const nonWps = futureComp.filter((x) => x.type !== "WPS" && !(x.label ?? "").toLowerCase().includes("wps")).filter((x) => {
    const key = `${x.label ?? ""}|${x.date ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  // Skip VAT return rows if client is not VAT registered
  const vatReg = String(client.vat_registered).toLowerCase();
  const ctReg = String(client.ct_registered).toLowerCase();
  const isVatRegistered = vatReg === "yes" || vatReg === "true";
  const isCtRegistered = ctReg === "yes" || ctReg === "true";
  const filteredNonWps = nonWps.filter((x) => {
    const lbl = (x.label ?? "").toLowerCase();
    const typ = (x.type ?? "").toLowerCase();
    if (!isVatRegistered && (typ === "vat" || lbl.includes("vat return"))) return false;
    if (!isCtRegistered && (typ === "ct" || lbl.includes("corporate tax return"))) return false;
    return true;
  });
  // Sort all by date, TBC last
  const compliance = [...(wpsNext ? [wpsNext] : []), ...filteredNonWps].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1; if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }) as { label?: string; type?: string; date?: string | null; _recurring?: boolean }[];

  // First delivery date — from contract analysis
  const { data: contractRow } = await supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "contract").maybeSingle();
  const contract = (contractRow?.data as ContractAnalysis | null) ?? null;
  let firstDelivery = "";
  if (contract?.deliverables?.[0]?.deadline) firstDelivery = contract.deliverables[0].deadline;
  else if (contract?.periodStart) firstDelivery = `Starts ${contract.periodStart}${contract.reportingFrequency ? ` (${contract.reportingFrequency} cadence)` : ""}`;

  // Team
  const { data: teamRows } = await supabase
    .from("run_team")
    .select("role_in_run,team_members(full_name,email,role)")
    .eq("run_id", runId);
  type TeamRow = { role_in_run: string; team_members: { full_name: string; email?: string; role?: string } | { full_name: string; email?: string; role?: string }[] | null };
  const team = (teamRows ?? []).map((t: TeamRow) => {
    const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
    return tm ? { role: t.role_in_run, name: tm.full_name, email: (tm as { email?: string }).email ?? "" } : null;
  }).filter(Boolean) as { role: string; name: string; email: string }[];

  // Uploaded documents (client portal + Drive)
  const { data: docRows } = await supabase.from("documents").select("label,status").eq("client_id", run.client_id);
  const uploadedDocs = (docRows ?? []).filter((d) => d.status === "uploaded" || d.status === "received").map((d) => d.label as string);

  const reg = (client.reg_facts as { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string } | null) ?? {};

  const ctx = `Client: ${client.name}; owner ${client.owner_name ?? "n/a"}; industry ${client.industry ?? "n/a"}; entity ${client.entity_type ?? "n/a"}; VAT ${client.vat_registered ? "registered" : "not registered"}; CT ${client.ct_registered ? "registered" : "not registered"}.\n` +
    `UAE registration facts: incorporation ${reg.incorporationDate ?? "n/a"}; trade licence expiry ${reg.tradeLicenceExpiry ?? "n/a"}; VAT first filing ${reg.vatFirstFiling ?? "n/a"}; CT first filing ${reg.ctFirstFiling ?? "n/a"}.\n` +
    `First delivery: ${firstDelivery || "to be confirmed once data is in"}.\n` +
    `Assigned team: ${team.length ? team.map((t) => `${t.role}: ${t.name}${t.email ? ` <${t.email}>` : ""}`).join("; ") : "team not yet assigned"}.\n` +
    `Documents received from client: ${uploadedDocs.length ? uploadedDocs.join(", ") : "none uploaded yet"}.\n` +
    `Compliance calendar items: ${compliance.length ? compliance.map((c) => `${c.label} (${c.type}) due ${c.date}`).join("; ") : "none extracted yet"}.`;

  try {
    const text = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You write polished client-facing one-pagers for a UAE accounting firm called Finanshels (www.finanshels.com). Finanshels is a modern UAE accounting firm known for tech-forward, proactive service. Output plain text only — no markdown, no headings with #, no asterisks. Use only the details given; never invent. Where documents are listed, mention they have been received to reassure the client.",
      prompt:
        `Write a tight one-pager that summarises everything the client needs to know after onboarding completes — for the AM to share before recurring delivery starts. Sections in order:\n` +
        `1) Compliance calendar — the next 12 months of UAE filings & expiries (bullet list). If no items provided, write "We will set up your compliance calendar once your VAT/CT registration details are confirmed."\n` +
        `2) First delivery date — when the first report will land.\n` +
        `3) Documents received — list the documents the client has already submitted (shows progress and builds trust). Omit if none.\n` +
        `4) Your Finanshels team — names + roles + emails.\n` +
        `5) UAE compliance details — incorporation, trade licence expiry, VAT & CT first filings. Omit lines that are "n/a".\n\n` +
        `Keep it under 400 words. Warm, professional, Finanshels brand voice — tech-forward UAE accounting firm. No jargon.\n\nDetails:\n${ctx}`,
    });
    const generatedAt = new Date().toISOString();
    const complianceItems = compliance.map((c) => {
      const datePart = c.date ? ` — ${c.date}` : " — To be confirmed";
      const recurringPart = c._recurring ? " (monthly recurring)" : "";
      return `${c.label}${datePart}${c.type ? ` (${c.type})` : ""}${recurringPart}`;
    });
    const sections = [
      { heading: "Compliance calendar", items: complianceItems },
      { heading: "First delivery", items: firstDelivery ? [firstDelivery] : ["To be confirmed once data is in."] },
      ...(uploadedDocs.length ? [{ heading: "Documents received", items: uploadedDocs }] : []),
      { heading: "Your Finanshels team", items: team.map((t) => `${t.role.toUpperCase()} — ${t.name}${t.email ? ` · ${t.email}` : ""}`) },
      { heading: "UAE compliance details", items: [
        reg.incorporationDate ? `Incorporation: ${reg.incorporationDate}` : null,
        (reg as Record<string, string>).licence_expiry ? `Trade licence expires: ${(reg as Record<string, string>).licence_expiry}` : reg.tradeLicenceExpiry ? `Trade licence expires: ${reg.tradeLicenceExpiry}` : null,
        reg.vatFirstFiling ? `VAT — first filing: ${reg.vatFirstFiling}` : null,
        reg.ctFirstFiling ? `Corporate Tax — first filing: ${reg.ctFirstFiling}` : null,
      ].filter(Boolean) as string[] },
    ];

    // WhatsApp message — deterministic, no AI
    const am = team.find((t) => t.role === "am") ?? team[0];
    const nextUpcoming = compliance.find((c) => c.date);
    const nextDeadlineStr = nextUpcoming ? `${nextUpcoming.label} on ${nextUpcoming.date}` : "";
    const whatsappMsg = buildWhatsAppMsg({
      ownerName: (client.owner_name as string | null) ?? "",
      amName: am?.name ?? "Your Account Manager",
      amEmail: am?.email ?? "team@finanshels.com",
      clientName: client.name as string,
      nextDeadline: nextDeadlineStr,
      docsCount: uploadedDocs.length,
      firstDelivery,
    });

    const admin = createAdminClient();
    const { data: existing } = await admin.from("run_items").select("id").eq("run_id", runId).eq("kind", "onepager").maybeSingle();
    const payload = { generated: text, sections, generatedAt, notes: "", whatsappMsg };
    if (existing) {
      const { data: cur } = await admin.from("run_items").select("data").eq("id", existing.id).maybeSingle();
      const curData = (cur?.data ?? {}) as { notes?: string };
      payload.notes = curData.notes ?? "";
      await admin.from("run_items").update({ data: payload }).eq("id", existing.id);
    } else {
      await admin.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "onepager", data: payload });
    }
    return { data: { generated: text, sections, generatedAt, whatsappMsg } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

/** Save the AM's notes appended to the run's one-pager. */
export async function saveOnePagerNotes(runId: string, notes: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("run_items").select("id,data").eq("run_id", runId).eq("kind", "onepager").maybeSingle();
  if (!row) return { error: "Generate the one-pager first." };
  const next = { ...((row.data ?? {}) as Record<string, unknown>), notes };
  const { error } = await admin.from("run_items").update({ data: next }).eq("id", row.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Re-runs the generator — same as generateOnePager (kept as a distinct export for the UI button). */
export async function regenerateOnePager(runId: string) {
  return generateOnePager(runId);
}

/**
 * AI-drafts the "Onboarding update" Email AND a short WhatsApp message from the task board.
 * Uses the org's configured AI provider (OpenAI by default) — never invents tasks, works
 * only from the rows passed in. The contact's first name (not the company name) is used
 * for the greeting. Returns ready-to-paste subject + body + whatsapp.
 */
export async function generateTaskBoardEmailDraft(
  runId: string,
  payload: {
    clientName: string;
    contactName?: string | null;
    completed: { title: string; notes?: string | null }[];
    inProgress: { title: string; notes?: string | null }[];
    includeForm?: boolean;
  },
): Promise<{ error?: string; subject?: string; body?: string; whatsapp?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const { clientName, contactName, completed, inProgress } = payload;
  const includeForm = payload.includeForm !== false;
  const greetName = ((contactName ?? "").trim().split(/\s+/)[0]) || clientName;
  const FEEDBACK_URL = "https://forms.gle/UUdX1HR21UMGLMhFA";

  const completedList = completed.length
    ? completed.map((t, i) => `${i + 1}. ${t.title}${t.notes ? ` — notes: ${t.notes}` : ""}`).join("\n")
    : "(none)";
  const inProgressList = inProgress.length
    ? inProgress.map((t, i) => `${i + 1}. ${t.title}${t.notes ? ` — notes: ${t.notes}` : ""}`).join("\n")
    : "(none)";

  const emailFeedbackBlock = includeForm
    ? `A quick favour\n` +
      `We'd really value 1 minute of your feedback on how the onboarding has gone so far—the communication from the team, the process, and your experience with the onboarding portal:\n` +
      `${FEEDBACK_URL}\n\n`
    : ``;
  const whatsappFeedbackLine = includeForm
    ? `Lastly, if you have a spare minute, we'd love your feedback on the onboarding process: ${FEEDBACK_URL} (this is for internal purposes only)\n\n`
    : ``;

  const system =
    "You write client-facing onboarding update messages for Finanshels, a UAE accounting firm. " +
    "Output must be polished and ready to send as-is — NEVER use [placeholders] or brackets. " +
    "The greeting uses the contact's FIRST NAME (a person), not the company name. " +
    "Use ONLY the tasks and notes provided. Do not invent tasks, statuses, deadlines, or systems. " +
    "Warm, professional, concise. Plain text only — no markdown. " +
    "Return STRICT JSON only, no prose, no code fences: " +
    `{"body": "<email body text>", "whatsapp": "<whatsapp message text>"}.`;

  const prompt =
    `Draft TWO things from the same task data: (1) an EMAIL body and (2) a short WHATSAPP message. ` +
    `Greet the contact by first name ("${greetName}") — never use the company name as a person. ` +
    `Use ONLY the tasks below; for each In-progress item add ONE short sentence explaining why it's in progress (grounded in notes; if notes are empty, a neutral one-liner). Do not add or remove sections.\n\n` +
    `===== EMAIL TEMPLATE =====\n` +
    `Hi ${greetName},\n\n` +
    `Hope you're doing well. Here's a quick update on where we stand with your onboarding since we kicked off.\n\n` +
    `Where we are\n\n` +
    `Completed:\n\n` +
    `<numbered list of completed task titles, each on its own line, like "1. Task title.">\n\n` +
    `In progress:\n\n` +
    `<numbered list of in-progress tasks, each "N. Task title: <one sentence why>.">\n\n\n` +
    emailFeedbackBlock +
    `Thank you for your time through this process—looking forward to getting everything fully aligned!\n\n` +
    `Best Regards,\n` +
    `Team Finanshels\n\n` +
    `===== WHATSAPP TEMPLATE (use emojis, short, mirrors the email summary) =====\n` +
    `Hi @~${greetName} , quick onboarding update 👋\n\n` +
    `I've sent a detailed breakdown over email, but here is a quick summary of where we stand:\n\n` +
    `🔄 Our Updates:\n` +
    `<numbered list of the IN-PROGRESS items, each "N. Task title: <one short sentence why>.">\n\n\n` +
    whatsappFeedbackLine +
    `Thanks so much—excited to get started!\n\n` +
    `===== DATA =====\n` +
    `Contact first name: ${greetName}\n` +
    `Company name (do NOT use as greeting): ${clientName}\n` +
    `Completed tasks:\n${completedList}\n\n` +
    `In-progress tasks (any status that isn't "complete"):\n${inProgressList}\n\n` +
    `Include feedback link: ${includeForm ? "YES" : "NO — omit the feedback paragraph/line entirely from both"}\n\n` +
    `Output STRICT JSON only: {"body":"...", "whatsapp":"..."}. No code fences, no commentary.`;

  try {
    const raw = await runAi(session.profile.org_id, "mom", { runId, system, prompt });
    const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
    if (s < 0 || e < s) return { error: "AI returned no JSON." };
    let parsed: { body?: string; whatsapp?: string };
    try {
      parsed = JSON.parse(raw.slice(s, e + 1)) as { body?: string; whatsapp?: string };
    } catch {
      return { error: "AI returned malformed JSON." };
    }
    const subject = `Your Onboarding: Where We Are + What's Next <> ${clientName}`;
    return { subject, body: (parsed.body ?? "").trim(), whatsapp: (parsed.whatsapp ?? "").trim() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}
