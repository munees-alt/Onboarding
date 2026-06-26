"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageCoa } from "@/lib/roles";
import { defaultTaxCodesFor, type TaxCode } from "@/lib/tax-codes";

async function guard() {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!canManageCoa(role)) return { error: "Only the Master Admin, Ops Head or AM can manage tax codes." };
  return { orgId: session.profile.org_id };
}

export async function saveTaxCodeSet(input: { id?: string; industry: string; codes: TaxCode[] }): Promise<{ error?: string; ok?: boolean }> {
  const g = await guard(); if (g.error) return g;
  if (!input.industry?.trim()) return { error: "Industry is required." };
  const admin = createAdminClient();
  const codes = input.codes.filter((c) => c.code?.trim() && c.name?.trim()).map((c) => ({
    code: c.code.trim(),
    name: c.name.trim(),
    rate: Number(c.rate) || 0,
    kind: c.kind,
    notes: c.notes?.trim() || undefined,
  }));
  const { error } = await admin.from("tax_code_sets").upsert(
    { org_id: g.orgId!, industry: input.industry.trim(), codes, source: "manual", updated_at: new Date().toISOString() },
    { onConflict: "org_id,industry" },
  );
  if (error) return { error: error.message };
  revalidatePath("/master-tax-codes");
  return { ok: true };
}

export async function deleteTaxCodeSet(industry: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await guard(); if (g.error) return g;
  const admin = createAdminClient();
  const { error } = await admin.from("tax_code_sets").delete().eq("org_id", g.orgId!).eq("industry", industry);
  if (error) return { error: error.message };
  revalidatePath("/master-tax-codes");
  return { ok: true };
}

/** Reset an industry to the UAE default + overlay. Useful after edits diverge. */
export async function resetTaxCodeSet(industry: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await guard(); if (g.error) return g;
  const admin = createAdminClient();
  const { error } = await admin.from("tax_code_sets").upsert(
    { org_id: g.orgId!, industry, codes: defaultTaxCodesFor(industry), source: "seed", updated_at: new Date().toISOString() },
    { onConflict: "org_id,industry" },
  );
  if (error) return { error: error.message };
  revalidatePath("/master-tax-codes");
  return { ok: true };
}
