import "server-only";
import { createAdminClient } from "./supabase/admin";
import coaDataRaw from "./coa-templates.json";

type Raw = { code: string; account: string; category?: string; tag?: string };
const coaData = coaDataRaw as unknown as Record<string, Raw[]>;

export interface MasterLine { code: string; account: string; section: string }
export interface MasterCoa { industry: string; accounts: MasterLine[] }

export function sectionOf(cat?: string): string {
  const c = (cat || "").toLowerCase();
  if (c.includes("asset")) return "Assets";
  if (c.includes("liabilit")) return "Liabilities";
  if (c.includes("equity")) return "Equity";
  if (c.includes("income") || c.includes("revenue")) return "Income";
  if (c.includes("cost of") || c.includes("cogs")) return "Cost of Goods";
  if (c.includes("expense")) return "Expenses";
  return "Other";
}

/** Returns the org's Master COA library, seeding it from the Finanshels workbook on first use. */
export async function getMasterCoas(orgId: string): Promise<MasterCoa[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("coa_master").select("industry,accounts").eq("org_id", orgId).order("industry");
  if (data?.length) return data.map((r) => ({ industry: r.industry, accounts: (r.accounts ?? []) as MasterLine[] }));

  const seed: MasterCoa[] = Object.entries(coaData).map(([industry, accts]) => ({
    industry,
    accounts: accts.map((a) => ({ code: a.code, account: a.account, section: sectionOf(a.category) })),
  }));
  await admin.from("coa_master").insert(seed.map((s) => ({ org_id: orgId, industry: s.industry, accounts: s.accounts })));
  return seed;
}
