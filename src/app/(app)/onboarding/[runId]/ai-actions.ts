"use server";

import coaDataRaw from "@/lib/coa-templates.json";
import { runAi } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { completeStep } from "./actions";

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
  agenda: { feature: "agenda", instruction: "Write a polished, client-ready kickoff-call agenda as a short email with a greeting and 5-7 clear agenda points. Ready to send as-is." },
  ai: { feature: "mom", instruction: "Write professional minutes of meeting as a ready-to-send client email: warm greeting to the client by name, a short paragraph on what was covered, a 'Decisions' list, an 'Action items' list (each with owner and due date), 'Next steps', and a Finanshels sign-off. Complete and polished." },
  mom: { feature: "mom", instruction: "Write the minutes-of-meeting email to send to the client now: greeting by name, summary, decisions, action items (owner + due), next steps, signed off by the Finanshels team. Ready to send." },
  welcome_email: { feature: "welcome_email", instruction: "Write a warm, professional welcome email from the Finanshels account manager to the client after the kickoff call: thank them, confirm scope and timeline, note the COA review and next steps, sign off. Ready to send." },
  deck: { feature: "handover_summary", instruction: "Write a short, branded client onboarding deck as slide-by-slide content (Slide title + 1-2 lines each): Welcome, Scope of service, Your team, Timeline & milestones, What we need from you, How we work. Client-ready." },
  brief: { feature: "brief", instruction: "Write a sharp internal pre-call brief: business overview, UAE regulatory points (VAT/CT/WPS), the 4-5 best questions to ask on the call, risk/complexity flags, and a COA template recommendation. Concise and specific." },
};

/** Generates AI text for a run step (agenda, MoM, welcome email, deck, brief). */
export async function generateStepText(
  runId: string,
  actType: string,
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

  // Minutes of meeting MUST be based on the real recording + notes — never invented.
  let meetingBlock = "";
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
    if (!p.recording?.trim() || !p.notes?.trim()) {
      return { error: "Add the meeting recording link and your notes on the call step first — minutes are written from the real meeting, not generated blank." };
    }
    meetingBlock = `\n\nThe meeting actually happened. Write the minutes ONLY from these real notes (do not add anything that isn't here):\nRecording: ${p.recording}\nNotes:\n${p.notes}`;
  }

  const ctx =
    `Client: ${client.name}; owner ${client.owner_name ?? "n/a"}; industry ${client.industry}; entity ${client.entity_type}; ` +
    `VAT ${client.vat_registered}; CT ${client.ct_registered}; ` +
    `revenue channels ${(client.revenue_channels ?? []).join(", ") || "n/a"}; ` +
    `accounting software ${client.accounting_software ?? "n/a"}.` +
    (team ? ` Assigned team — ${team}.` : "");

  try {
    const text = await runAi(session.profile.org_id, cfg.feature, {
      runId,
      system: "You write for a UAE accounting firm (Finanshels). Output must be polished and ready to send AS-IS — NEVER use [placeholders], brackets, or 'insert X here'; use the real client and team names provided. If a needed detail isn't in the context, leave it out rather than inventing it. Professional, warm, concise.",
      prompt: `${cfg.instruction}\n\nUse these real details (do not invent beyond them):\n${ctx}${meetingBlock}`,
    });
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
export async function generateCompliance(runId: string): Promise<{ error?: string; items?: { label: string; type: string; date: string }[] }> {
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
    return { items: parseArray(out) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
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
  deliverables?: Deliverable[]; // what we deliver + when (defaults applied, team-editable)
}

/** Finanshels standard delivery cadence (UAE) — used when the contract doesn't specify timelines.
 *  NOT exported: a "use server" file may only export async functions. */
const DEFAULT_DELIVERABLES: Deliverable[] = [
  { item: "Monthly management reports (P&L, balance sheet, cash flow)", frequency: "Monthly", deadline: "By the 15th of the following month" },
  { item: "Bookkeeping & reconciliations", frequency: "Monthly", deadline: "By the 15th of the following month" },
  { item: "VAT return preparation & submission", frequency: "Quarterly", deadline: "Within 28 days of quarter end" },
  { item: "Corporate Tax return", frequency: "Annual", deadline: "Within 9 months of financial year end" },
];

/** AI-extracts scope / period / inclusions / exclusions / payment terms / deliverables from a pasted engagement contract. */
export async function analyzeContract(runId: string, text: string): Promise<{ error?: string; result?: ContractAnalysis }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!text.trim()) return { error: "Paste the contract text first." };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      runId,
      system: "You extract structured data from UAE accounting engagement contracts. Output ONLY JSON.",
      prompt:
        `From this engagement contract, return ONLY JSON: {"periodStart":"YYYY-MM","periodEnd":"YYYY-MM","scope":"1-2 sentence summary","inclusions":["..."],"exclusions":["..."],"paymentTerms":"...","deliverables":[{"item":"...","frequency":"Monthly|Quarterly|Annual|One-off","deadline":"plain-English due date"}]}. ` +
        `For "deliverables", list every report or service we must deliver and WHEN. If the contract names a timeline, use it exactly. If it does not, apply Finanshels UAE defaults: monthly management reports & bookkeeping by the 15th of the FOLLOWING month; VAT return quarterly within 28 days of quarter-end; Corporate Tax annually within 9 months of year-end. ` +
        `periodStart/periodEnd are the service period. If a field is unknown use null/empty.\n\nContract:\n${text.slice(0, 8000)}`,
    });
    const start = out.indexOf("{"), end = out.lastIndexOf("}");
    const parsed = start >= 0 ? (JSON.parse(out.slice(start, end + 1)) as ContractAnalysis) : {};
    if (!parsed.deliverables || parsed.deliverables.length === 0) parsed.deliverables = DEFAULT_DELIVERABLES;
    return { result: parsed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

/** AI-researches the client from email domain + industry → client-facing description. */
export async function generateBusinessDescription(runId: string): Promise<{ error?: string; text?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("name,industry,entity_type,primary_contact_email").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };
  const domain = (client.primary_contact_email ?? "").split("@")[1] ?? "";
  try {
    const text = await runAi(session.profile.org_id, "brief", {
      runId,
      system: "You research UAE businesses. Write a concise, client-facing description (3-5 sentences) of what THIS business does — confirming back 'here's what we understood about your business'. Describe ONLY the client's business; never mention our firm, Finanshels, or the accounting services we provide. If the domain/industry give you too little to go on, say plainly that there's limited public information and ask the client to confirm — do NOT invent specifics, named products, or figures.",
      prompt: `Company: ${client.name}. Industry: ${client.industry ?? "unknown"}. Entity: ${client.entity_type ?? "unknown"}. Email domain: ${domain || "unknown"}. Using the domain and industry only, describe what this business most likely does, its likely revenue model and customer base in the UAE. If unsure, say so rather than guessing.`,
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
  compliance: { ct: string; vat: string; wps: string };
  software: { recommendation: string; existing: string };
  contract: { scope: string; highlights: string[]; payment: string; duration: string; responsibilities: string };
  nextSteps: { icon: string; title: string; desc: string }[];
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
    if (existing?.data && (existing.data as DeckData).clientName) return { deck: existing.data as DeckData };
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
    `"compliance":{"ct":"CT note specific to this client","vat":"VAT note","wps":"WPS note"}, ` +
    `"software":{"recommendation":"why Zoho Books suits them","existing":"one line on reviewing existing tools"}, ` +
    `"contract":{"scope":"","highlights":["",""],"payment":"","duration":"","responsibilities":""}, ` +
    `"nextSteps":[{"icon":"emoji","title":"","desc":""} x3]}`;

  let parsed: Partial<DeckData> & { mission?: string };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", { runId, system, prompt });
    const s = out.indexOf("{"), e = out.lastIndexOf("}");
    parsed = JSON.parse(out.slice(s, e + 1));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI failed. Check your AI key in Settings." };
  }

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
    compliance: parsed.compliance ?? { ct: "", vat: "", wps: "" },
    software: parsed.software ?? { recommendation: "", existing: "" },
    contract: parsed.contract ?? { scope: "", highlights: [], payment: "", duration: "", responsibilities: "" },
    nextSteps: parsed.nextSteps?.length ? parsed.nextSteps : [],
  };

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
  const { data: run } = await supabase.from("onboarding_runs").select("template_key").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  await supabase.from("run_steps").upsert(
    { run_id: runId, step_no: stepId, status: "complete", payload: { text }, completed_at: new Date().toISOString(), title: stepId, type: "ai" },
    { onConflict: "run_id,step_no" },
  );
  await completeStep(runId, stepId);
  return {};
}

/** AI-tailors the industry chart of accounts to this client. */
export async function generateCoa(
  runId: string,
): Promise<{ error?: string; accounts?: CoaLine[]; rationale?: string; industry?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
  if (!run) return { error: "Run not found." };
  const { data: client } = await supabase.from("clients").select("*").eq("id", run.client_id).maybeSingle();
  if (!client) return { error: "Client not found." };

  const tplIndustry = INDUSTRY_MAP[client.industry as string] ?? "General COA";
  const accounts = coaData[tplIndustry] ?? coaData["General COA"];
  const mandatoryLines: CoaLine[] = accounts
    .filter((a) => /mandatory/i.test(a.tag))
    .map((a) => ({ code: a.code, account: a.account, section: sectionOf(a), include: true }));

  const prompt =
    `Client: ${client.name}; industry ${client.industry}; entity ${client.entity_type}; ` +
    `VAT ${client.vat_registered}; CT ${client.ct_registered}; ` +
    `revenue channels ${(client.revenue_channels ?? []).join(", ") || "n/a"}; ` +
    `payment gateways ${(client.payment_gateways ?? []).join(", ") || "n/a"}; ` +
    `accounting software ${client.accounting_software ?? "n/a"}.\n\n` +
    `Base "${tplIndustry}" chart of accounts (code | account | tag):\n` +
    accounts.map((a) => `${a.code} | ${a.account} | ${a.tag}`).join("\n") +
    `\n\nIMPORTANT — classify by the CLIENT'S OWN primary business activity, NOT the industry of their customers. ` +
    `Example: a marketing agency serving F&B clients is a marketing / professional-services business (service revenue, no inventory/COGS) — it is NOT an F&B business. ` +
    `If the client spans multiple activities, choose the broader fit and add accounts for each material revenue line. The base template above is only a starting point — adapt it to what this client actually does. ` +
    `\n\nReturn ONLY a JSON object: {"industry":"the effective industry classification you used (e.g. 'Professional Services — Marketing')","rationale":"2-3 sentences on why this COA fits the client",` +
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
    industry: (parsed as { industry?: string }).industry || tplIndustry,
  };
}

/** Saves the tailored COA to the run and completes the COA step. */
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
