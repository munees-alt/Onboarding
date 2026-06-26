/**
 * Cleans a raw uploaded-document label (often the original filename like
 * "VAT CERTIFICATE-EMARGROW FZE LLC (1).pdf") into a presentable document
 * TYPE name suitable for the onboarding deck and onboarding portal: "VAT Certificate",
 * "Trade Licence", "Share Certificate", etc.
 *
 * Strategy: keyword-detect known UAE document types from the raw text.
 * If nothing matches, fall back to a normalised version of the filename
 * (strip extension, brackets, trailing version numbers, replace separators).
 */
const TYPE_RULES: { name: string; match: RegExp }[] = [
  { name: "Trade Licence",            match: /trade\s*licen[sc]e|tradelicense|\blicen[sc]e\b/i },
  { name: "VAT Certificate",          match: /vat[\s_-]*(cert|reg|registration)/i },
  { name: "Corporate Tax Certificate", match: /(corporate\s*tax|\bct\b)[\s_-]*(cert|reg|registration)/i },
  { name: "Share Certificate",        match: /share\s*cert/i },
  { name: "MOA / AOA",                match: /\b(moa|aoa)\b|articles\s*of\s*association|memorandum\s*of\s*association/i },
  { name: "Bank Statement",           match: /bank[\s_-]*statement/i },
  { name: "Passport",                 match: /passport/i },
  { name: "Emirates ID",              match: /emirates[\s_-]*id|\beid\b/i },
  { name: "Tenancy Contract",         match: /tenancy|lease|ejari/i },
  { name: "Establishment Card",       match: /establishment[\s_-]*card/i },
  { name: "Power of Attorney",        match: /power\s*of\s*attorney|\bpoa\b/i },
  { name: "Audited Financials",       match: /audited|audit\s*report/i },
  { name: "Prior Financial Statements", match: /financial\s*statement|p[\s&]*l|balance\s*sheet/i },
  { name: "Owner ID",                 match: /owner.*id|director.*id/i },
];

export function cleanDocLabel(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  for (const rule of TYPE_RULES) if (rule.match.test(v)) return rule.name;
  return v
    .replace(/\.(pdf|docx?|jpe?g|png|xlsx?|csv|txt)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s*\(\d+\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean + dedupe a list of raw labels into presentable type names. */
export function cleanDocLabels(labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const clean = cleanDocLabel(raw);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}
