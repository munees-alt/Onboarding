"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runAi } from "@/lib/ai";

/** AI-generates SOP steps from a plain-language description. */
export async function generateSopSteps(title: string, context: string): Promise<{ error?: string; steps?: string[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!title.trim()) return { error: "Give the SOP a title first." };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      system: "You write clear, numbered standard operating procedures for a UAE accounting firm. Output ONLY a JSON array of step strings.",
      prompt: `Write the steps for this SOP as a JSON array of concise step strings (6-12 steps). Title: "${title}". Context: ${context || "standard best practice"}.`,
    });
    const s = out.indexOf("["), e = out.lastIndexOf("]");
    const steps = s >= 0 ? (JSON.parse(out.slice(s, e + 1)) as string[]) : [];
    return { steps };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

export interface SopInput {
  id?: string;
  title: string;
  industry?: string;
  steps: string[];
  scope?: string;     // master | client | industry
  flow?: string;      // accounting | tax | general
  category?: string;  // bank | gateway | fta | ...
  clientId?: string | null;
}

export async function saveSop(input: SopInput): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.title.trim()) return { error: "Title required." };
  const supabase = await createClient();
  const row = {
    title: input.title.trim(),
    industry: input.industry?.trim() || null,
    steps: input.steps.filter((s) => s.trim()),
    scope: input.scope || "master",
    flow: input.flow || null,
    category: input.category || null,
    client_id: input.clientId || null,
  };
  if (input.id) {
    // Edit an existing SOP.
    const { error } = await supabase.from("sops").update(row).eq("id", input.id).eq("org_id", session.profile.org_id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("sops").insert({
      org_id: session.profile.org_id, ...row, created_by_name: session.teamMember?.full_name ?? session.email,
    });
    if (error) return { error: error.message };
  }
  revalidatePath("/sop");
  return {};
}

/** Finanshels standard access SOPs (bank / payment gateway / FTA). Seeded once per org. */
const ACCESS_SOPS: { title: string; flow: string; category: string; steps: string[] }[] = [
  {
    title: "Bank account access — handover & view rights", flow: "accounting", category: "bank",
    steps: [
      "Confirm which UAE bank(s) the client uses (from the intake form).",
      "Request read-only / viewer access for the assigned accountant via the bank's online portal.",
      "For Emirates NBD / FAB / ADCB: client adds the accountant as a 'Viewer' user under Manage Users.",
      "Verify the accountant can see statements and transactions but cannot initiate payments.",
      "Record the access grant in the client's Tools & Access tab and set a 90-day re-confirmation reminder.",
      "Never store the client's banking password — use the bank's native delegated-access feature only.",
    ],
  },
  {
    title: "Payment gateway access — reporting connection", flow: "accounting", category: "gateway",
    steps: [
      "Identify the client's gateways (Telr, PayTabs, Stripe, Network International, etc.) from the intake form.",
      "Request a reporting/finance role on the gateway dashboard (not admin).",
      "Connect the settlement report export or API key needed for reconciliation.",
      "Map gateway settlement accounts to the COA clearing accounts.",
      "Confirm payout schedule and fees so reconciliation matches bank deposits.",
      "Log the access in Tools & Access; rotate API keys per the security policy.",
    ],
  },
  {
    title: "FTA portal access — VAT & Corporate Tax", flow: "tax", category: "fta",
    steps: [
      "Confirm the client's FTA (EmaraTax) account and TRN.",
      "Request the client adds the firm as a Tax Agent / authorised user in EmaraTax.",
      "Verify access to VAT returns, CT registration and the filing calendar.",
      "Check registration status: VAT, Corporate Tax, and Excise if applicable.",
      "Note all filing deadlines into the client's compliance calendar.",
      "Never share FTA credentials over chat/email — use the EmaraTax delegated-access role.",
    ],
  },
];

export async function seedAccessSops(): Promise<{ error?: string; added?: number }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("sops").select("category").eq("org_id", session.profile.org_id).in("category", ["bank", "gateway", "fta"]);
  const have = new Set((existing ?? []).map((r) => r.category));
  const toAdd = ACCESS_SOPS.filter((s) => !have.has(s.category));
  if (!toAdd.length) return { added: 0 };
  const { error } = await supabase.from("sops").insert(
    toAdd.map((s) => ({
      org_id: session.profile!.org_id, title: s.title, steps: s.steps, scope: "master", flow: s.flow, category: s.category,
      industry: null, created_by_name: "Finanshels (standard)",
    })),
  );
  if (error) return { error: error.message };
  revalidatePath("/sop");
  return { added: toAdd.length };
}

export async function deleteSop(id: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.from("sops").delete().eq("id", id).eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  revalidatePath("/sop");
  return {};
}
