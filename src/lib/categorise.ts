// Rule-based bank-line categoriser. All COA codes + keyword lists live in the
// canonical Google Sheet (loaded via google-sheets.ts) — this file contains
// ONLY the rule ORDER and the matching logic. Mirrors the canonical Python
// reference (financial-statement-engine/lib/classifier.py) for parity:
//   - whole-word regex matching (not fuzzy) so "salary" doesn't accidentally
//     match "salary advance return" or "trade licence" half-match "licence"
//   - fixed confidence per rule source (0.95 hardcoded / 0.85 industry /
//     0.75 universal / 0.0 fallback)
//   - longer keyword wins on tie ("trade licence renewal" beats "licence")

export interface NormalisedTxn {
  txn_date: string;          // ISO YYYY-MM-DD
  value_date?: string;
  description: string;
  debit: number;             // money out (positive)
  credit: number;            // money in (positive)
  balance?: number;
  currency: string;          // ISO 3-letter, default AED
  source_file: string;
  source_row: number;
}

export interface KeywordRule {
  keyword: string;           // matched against description (whole-word, case-insensitive)
  code: string;              // COA code e.g. "5100"
  account_name: string;      // human-readable account name
}

export interface CoaSheetData {
  universal: KeywordRule[];          // Keywords - Universal tab
  industryOverlay: KeywordRule[];    // industry-specific tab (overrides universal)
  industry?: string;                 // industry label used (for the result trace)
}

export interface CategoriseSettings {
  match_threshold: number;           // auto-match threshold (0–1), default 0.75 (Python default)
  review_threshold: number;          // below match, above this = needs review, default 0.50
}

export const DEFAULT_SETTINGS: CategoriseSettings = {
  match_threshold: 0.75,
  review_threshold: 0.50,
};

export type RuleSource =
  | "Hardcoded-UAE" | "Industry" | "Universal" | "Fallback";

export interface CategoryResult {
  code: string;
  account_name: string;
  confidence: number;        // 0–1, fixed per source
  matched_keyword: string;   // the actual text that matched (or rule label for hardcoded)
  rule_source: RuleSource;
  rule_detail?: string;      // e.g. industry name, or hardcoded rule label
}

// ── Confidence levels (mirror Python classifier.py) ─────────────────────────
const CONF_HARDCODED = 0.95;
const CONF_INDUSTRY = 0.85;
const CONF_UNIVERSAL = 0.75;
const CONF_FALLBACK = 0.0;

// ── Hardcoded UAE rules (spec §3 items 1–4 + interest income) ───────────────
// These are universal across every UAE client. The COA codes still come from
// the canonical Universal COA — they're not "hard-coded codes", they're
// "hard-coded patterns that resolve to standard codes". If the user's COA
// renames these codes, change them in ONE place here.

interface HardcodedRule {
  regex: RegExp;
  code: string;
  account_name: string;
  label: string;
}

const HARDCODED_UAE: HardcodedRule[] = [
  // 1. Internal transfers — not a P&L hit
  { regex: /\b(own\s*account|inter(?:nal)?\s*transfer|inter\s*account|between\s*accounts)\b/i,
    code: "1090", account_name: "Inter-account Transfers", label: "internal_transfer" },
  // 2a. Payroll
  { regex: /\b(wps|salary|payroll|wages)\b/i,
    code: "5100", account_name: "Salaries & Wages", label: "payroll" },
  // 2b. VAT — payment direction
  { regex: /\b(fta|vat\s*payment|vat\s*due|vat\s*payable)\b/i,
    code: "2300", account_name: "VAT Payable / Output Tax", label: "fta_vat_payment" },
  // 2c. VAT — refund direction
  { regex: /\bvat\s*refund\b/i,
    code: "1400", account_name: "VAT Receivable / Input Tax", label: "fta_vat_refund" },
  // 3. Bank charges
  { regex: /\b(bank\s*charge|service\s*charge|wire\s*fee|swift\s*fee|outward\s*remittance\s*fee)\b/i,
    code: "5920", account_name: "Bank Charges", label: "bank_charges" },
  // 4. Interest income (only treat "interest credit/earned/income" as income;
  //    debit-side "interest" is loan interest and should fall to a sheet rule)
  { regex: /\binterest\s*(credit|earned|income|received|profit)\b/i,
    code: "4910", account_name: "Interest Income", label: "interest_income" },
];

// ── Whole-word keyword → regex compile (mirrors Python _keyword_to_regex) ──
// Treats a multi-token keyword as a whole-word match where internal whitespace
// is flexible: "trade licence" matches "Trade  Licence" but NOT "untraded".
function compileKeyword(keyword: string): RegExp {
  const escaped = keyword
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return /(?!)/; // never matches
  return new RegExp("\\b" + escaped.join("\\s+") + "\\b", "i");
}

interface CompiledRule extends KeywordRule {
  rx: RegExp;
}

const compileCache = new WeakMap<KeywordRule[], CompiledRule[]>();
function compileRules(rules: KeywordRule[]): CompiledRule[] {
  const hit = compileCache.get(rules);
  if (hit) return hit;
  // Sort by keyword length desc so "trade licence renewal" beats "licence"
  // (Python: _scan_rules sorts the same way).
  const sorted = [...rules].sort((a, b) => b.keyword.length - a.keyword.length);
  const compiled: CompiledRule[] = sorted.map((r) => ({ ...r, rx: compileKeyword(r.keyword) }));
  compileCache.set(rules, compiled);
  return compiled;
}

function scanRules(description: string, rules: CompiledRule[]): { rule: CompiledRule; match: string } | null {
  for (const r of rules) {
    const m = description.match(r.rx);
    if (m) return { rule: r, match: m[0] };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-line classifier — rule order per spec §3 + Python parity.
// Returns (code, account_name, confidence, matched_keyword, rule_source) so the
// Review output can explain WHY each line landed where it did.

export function classifyTxn(
  txn: NormalisedTxn,
  coa: CoaSheetData,
  _settings: CategoriseSettings = DEFAULT_SETTINGS,
): CategoryResult {
  const desc = (txn.description || "").trim();
  if (!desc) {
    return { code: "6900", account_name: "Uncategorised — Review", confidence: CONF_FALLBACK, matched_keyword: "", rule_source: "Fallback" };
  }

  // 1. Hardcoded UAE rules (always checked first)
  for (const r of HARDCODED_UAE) {
    const m = desc.match(r.regex);
    if (m) return { code: r.code, account_name: r.account_name, confidence: CONF_HARDCODED, matched_keyword: m[0], rule_source: "Hardcoded-UAE", rule_detail: r.label };
  }

  // 2. Industry overlay (higher confidence than universal)
  if (coa.industryOverlay.length) {
    const hit = scanRules(desc, compileRules(coa.industryOverlay));
    if (hit) return { code: hit.rule.code, account_name: hit.rule.account_name, confidence: CONF_INDUSTRY, matched_keyword: hit.match, rule_source: "Industry", rule_detail: coa.industry };
  }

  // 3. Universal rules
  if (coa.universal.length) {
    const hit = scanRules(desc, compileRules(coa.universal));
    if (hit) return { code: hit.rule.code, account_name: hit.rule.account_name, confidence: CONF_UNIVERSAL, matched_keyword: hit.match, rule_source: "Universal" };
  }

  // 4. Fallback
  return { code: "6900", account_name: "Uncategorised — Review", confidence: CONF_FALLBACK, matched_keyword: "", rule_source: "Fallback" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole-batch helper — returns the categorised rows + a summary suited to the
// step's run_items payload and the modal preview.

export interface CategorisedRow {
  txn: NormalisedTxn;
  category: CategoryResult;
}

export interface BatchSummary {
  total_lines: number;
  total_debit: number;
  total_credit: number;
  needs_review: number;       // count routed to 6900 OR confidence < settings.match_threshold
  by_code: Record<string, { account_name: string; count: number; net: number }>;
}

export function categoriseBatch(
  txns: NormalisedTxn[],
  coa: CoaSheetData,
  settings: CategoriseSettings = DEFAULT_SETTINGS,
): { rows: CategorisedRow[]; summary: BatchSummary } {
  const rows: CategorisedRow[] = txns.map((txn) => ({ txn, category: classifyTxn(txn, coa, settings) }));
  const summary: BatchSummary = {
    total_lines: rows.length,
    total_debit: rows.reduce((n, r) => n + (r.txn.debit || 0), 0),
    total_credit: rows.reduce((n, r) => n + (r.txn.credit || 0), 0),
    needs_review: 0,
    by_code: {},
  };
  for (const r of rows) {
    const { code, account_name, confidence } = r.category;
    if (code === "6900" || confidence < settings.match_threshold) summary.needs_review++;
    const bucket = (summary.by_code[code] ??= { account_name, count: 0, net: 0 });
    bucket.count++;
    bucket.net += (r.txn.credit || 0) - (r.txn.debit || 0);
  }
  return { rows, summary };
}
