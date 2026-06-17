"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runAi } from "@/lib/ai";
import { canManageCoa } from "@/lib/roles";
import type { MasterLine } from "@/lib/master-coa";

const SECTIONS = ["Assets", "Liabilities", "Equity", "Income", "Cost of Goods", "Expenses", "Other"];

export async function saveMasterCoa(industry: string, accounts: MasterLine[]): Promise<{ error?: string }> {
  const session = await getSession();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  if (!session?.profile.org_id || !canManageCoa(role)) return { error: "Only the Master Admin, Ops Head or AM can manage the Master COA." };
  if (!industry.trim()) return { error: "Industry name is required." };
  const clean = accounts
    .filter((a) => a.account?.trim())
    .map((a) => ({ code: (a.code ?? "").trim(), account: a.account.trim(), section: SECTIONS.includes(a.section) ? a.section : "Other" }));
  const supabase = await createClient();
  const { error } = await supabase.from("coa_master").upsert(
    { org_id: session.profile.org_id, industry: industry.trim(), accounts: clean, updated_at: new Date().toISOString() },
    { onConflict: "org_id,industry" },
  );
  if (error) return { error: error.message };
  revalidatePath("/master-coa");
  return {};
}

export async function deleteMasterCoa(industry: string): Promise<{ error?: string }> {
  const session = await getSession();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  if (!session?.profile.org_id || !canManageCoa(role)) return { error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase.from("coa_master").delete().eq("org_id", session.profile.org_id).eq("industry", industry);
  if (error) return { error: error.message };
  revalidatePath("/master-coa");
  return {};
}

/** AI-builds a UAE chart of accounts for an industry not yet in the library. */
export async function generateMasterCoa(industry: string, note: string): Promise<{ error?: string; accounts?: MasterLine[] }> {
  const session = await getSession();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  if (!session?.profile.org_id || !canManageCoa(role)) return { error: "Not allowed." };
  if (!industry.trim()) return { error: "Name the industry first." };
  try {
    const out = await runAi(session.profile.org_id, "coa", {
      system: "You are a UAE chart-of-accounts expert (FTA-compliant). Output ONLY a JSON array, no prose. Use real, standard account names — no placeholders.",
      prompt:
        `Build a practical UAE chart of accounts for a "${industry}" business as a JSON array ` +
        `[{"code":"1000","account":"","section":"Assets|Liabilities|Equity|Income|Cost of Goods|Expenses"}]. ` +
        `Cover all six sections with sensible 4-digit codes and the accounts a UAE ${industry} business actually needs (VAT payable/receivable, etc.).` +
        (note.trim() ? ` Extra context: ${note.trim()}` : ""),
    });
    const s = out.indexOf("["), e = out.lastIndexOf("]");
    const arr = s >= 0 ? (JSON.parse(out.slice(s, e + 1)) as MasterLine[]) : [];
    const clean = arr
      .filter((a) => a.account?.trim())
      .map((a) => ({ code: String(a.code ?? "").trim(), account: a.account.trim(), section: SECTIONS.includes(a.section) ? a.section : "Other" }));
    if (!clean.length) return { error: "AI didn't return accounts. Try again or add them manually." };
    return { accounts: clean };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed. Check your AI key in Settings." };
  }
}
