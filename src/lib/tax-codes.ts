import "server-only";
import { createAdminClient } from "./supabase/admin";

export type TaxKind = "standard" | "zero" | "exempt" | "rcm" | "out_of_scope";
export interface TaxCode {
  code: string;
  name: string;
  rate: number;          // percentage
  kind: TaxKind;
  notes?: string;
}

export interface TaxCodeSet {
  id?: string;
  industry: string;
  codes: TaxCode[];
  source: string;
}

/**
 * UAE baseline tax codes shared across every industry. Industry-specific
 * sheets layer on top (e.g. healthcare adds exempt categories, ecommerce adds
 * marketplace RCM nuance). The Master Admin can override/extend freely.
 */
export const UAE_BASE_TAX_CODES: TaxCode[] = [
  { code: "VAT-S5", name: "Standard rated 5%", rate: 5, kind: "standard", notes: "Default for taxable supplies in the UAE." },
  { code: "VAT-Z0", name: "Zero rated", rate: 0, kind: "zero", notes: "Exports, qualifying transport, certain healthcare/education." },
  { code: "VAT-EX", name: "Exempt", rate: 0, kind: "exempt", notes: "Residential rent, life insurance, certain financial services." },
  { code: "VAT-RCM", name: "Reverse charge (5%)", rate: 5, kind: "rcm", notes: "Imports of goods/services where the recipient self-accounts." },
  { code: "VAT-OOS", name: "Out of scope", rate: 0, kind: "out_of_scope", notes: "Non-business / outside-UAE supplies." },
  { code: "CT-0", name: "Corporate Tax 0%", rate: 0, kind: "standard", notes: "Below AED 375k threshold or qualifying free-zone income." },
  { code: "CT-9", name: "Corporate Tax 9%", rate: 9, kind: "standard", notes: "Above AED 375k taxable income." },
];

const INDUSTRY_OVERLAY: Record<string, TaxCode[]> = {
  "Healthcare & Medical": [
    { code: "VAT-Z0-HC", name: "Zero-rated — qualifying healthcare", rate: 0, kind: "zero", notes: "Preventive + basic curative services to natural persons." },
    { code: "VAT-EX-HC", name: "Exempt — bare-land lease in clinic", rate: 0, kind: "exempt", notes: "If applicable to the clinic's premises." },
  ],
  "Education & Training": [
    { code: "VAT-Z0-EDU", name: "Zero-rated — qualifying education", rate: 0, kind: "zero", notes: "Tuition + related student services from a qualifying institution." },
  ],
  "Real Estate & Property Management": [
    { code: "VAT-EX-RES", name: "Exempt — residential rent", rate: 0, kind: "exempt", notes: "After the first 3 years from completion." },
    { code: "VAT-Z0-RES1", name: "Zero-rated — first sale residential", rate: 0, kind: "zero", notes: "First supply of a new residential building." },
    { code: "VAT-S5-COMM", name: "Standard rated — commercial rent", rate: 5, kind: "standard" },
  ],
  "Logistics, Transport & Supply Chain": [
    { code: "VAT-Z0-EXP", name: "Zero-rated — international transport", rate: 0, kind: "zero" },
    { code: "VAT-RCM-IMP", name: "Reverse charge — imported services", rate: 5, kind: "rcm" },
  ],
  "E-commerce": [
    { code: "VAT-RCM-MP", name: "Reverse charge — marketplace import", rate: 5, kind: "rcm", notes: "Goods sold via a non-resident platform with UAE delivery." },
    { code: "VAT-Z0-EXP", name: "Zero-rated — exports", rate: 0, kind: "zero" },
  ],
  "Financial Services & Fintech": [
    { code: "VAT-EX-FIN", name: "Exempt — margin-based financial services", rate: 0, kind: "exempt", notes: "Interest, life insurance and certain Islamic finance products." },
  ],
  "Hospitality, Travel & Tourism": [
    { code: "VAT-S5-HSP", name: "Standard rated — accommodation & F&B", rate: 5, kind: "standard" },
    { code: "TS-7", name: "Tourism Service Tax 7%", rate: 7, kind: "standard", notes: "Hotel guest charge in many emirates — local rate varies." },
  ],
};

/** Default tax-code list for an industry — UAE baseline + overlay (if any). */
export function defaultTaxCodesFor(industry: string): TaxCode[] {
  const overlay = INDUSTRY_OVERLAY[industry] ?? [];
  return [...UAE_BASE_TAX_CODES, ...overlay];
}

/** All tax-code sets for an org, seeded lazily on first read. */
export async function getTaxCodeSets(orgId: string): Promise<TaxCodeSet[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tax_code_sets")
    .select("id,industry,codes,source")
    .eq("org_id", orgId)
    .order("industry");
  return ((data ?? []) as TaxCodeSet[]);
}

/** Lazy-seed the UAE baseline + the priority industry overlays for an org if absent. */
export async function ensureSeedTaxCodes(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("tax_code_sets").select("industry").eq("org_id", orgId);
  if ((data ?? []).length > 0) return;
  const seedIndustries = ["UAE Baseline", "Healthcare & Medical", "Education & Training", "Real Estate & Property Management", "Logistics, Transport & Supply Chain", "E-commerce", "Financial Services & Fintech", "Hospitality, Travel & Tourism"];
  const rows = seedIndustries.map((industry) => ({
    org_id: orgId,
    industry,
    codes: industry === "UAE Baseline" ? UAE_BASE_TAX_CODES : defaultTaxCodesFor(industry),
    source: "seed",
  }));
  await admin.from("tax_code_sets").insert(rows);
}
