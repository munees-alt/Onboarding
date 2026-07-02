import "server-only";
import { getValidGoogleToken, getDriveCapableMemberId } from "./google";
import type { CoaSheetData, KeywordRule, CategoriseSettings } from "./categorise";

// Canonical Finanshels COA Google Sheet — single source of truth. Override via
// env if you ever fork. NEVER hard-code COA codes or keyword rules in app
// code; always load them from here.
const COA_SHEET_ID =
  process.env.FINANSHELS_COA_SHEET_ID || "1XBtL1_CXxm9kngOTqwxev8cv-LoI0Wi4WsarXnwh1TI";

// Expected tab names on the sheet (configure via env if your sheet differs).
const UNIVERSAL_TAB = process.env.COA_TAB_UNIVERSAL || "Keywords - Universal";
const SETTINGS_TAB = process.env.COA_TAB_SETTINGS || "Match Settings";

// Canonical industry → overlay-tab map. Mirrors INDUSTRY_TABS in the Python
// reference (coa_loader.py). When the client's industry string maps to one of
// these (loose match), we read that tab as the industry overlay; otherwise the
// categoriser runs universal-only.
const INDUSTRY_TABS: { match: RegExp; tab: string; label: string }[] = [
  { match: /\b(marketing|agency|ad\s*agency|creative)\b/i, tab: "Keywords - Marketing Agency", label: "Marketing Agency" },
  { match: /\b(restaurant|f\s*&\s*b|food|beverage|cafe|bakery|catering|hospitality)\b/i, tab: "Keywords - Restaurant - F&B", label: "Restaurant / F&B" },
  { match: /\b(retail|e?\s*-?\s*commerce|store|shop)\b/i, tab: "Keywords - Retail", label: "Retail" },
  { match: /\breal\s*estate\b|\bproperty\b|\bbroker(age)?\b/i, tab: "Keywords - Real Estate", label: "Real Estate" },
  { match: /\b(consult(ing|ancy)?|tech|software|saas|it\s*services)\b/i, tab: "Keywords - Consulting - Tech", label: "Consulting / Tech" },
];

/** Resolve a free-text industry string from clients.industry → canonical
 *  overlay tab name. Returns null if no industry overlay matches (the
 *  categoriser falls back to Universal-only). */
export function resolveIndustryTab(industry: string | null | undefined): { tab: string; label: string } | null {
  if (!industry) return null;
  for (const m of INDUSTRY_TABS) {
    if (m.match.test(industry)) return { tab: m.tab, label: m.label };
  }
  return null;
}

// In-memory cache (per server process). Reload at most every 5 min so a sheet
// edit reaches the next run quickly — but a high-volume catchup doesn't hammer
// the Sheets API on every line.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: CoaSheetData; settings: CategoriseSettings }>();

/** GET a sheet range as raw rows (A1 notation). Returns [] on any error. */
async function readRange(token: string, sheetId: string, a1: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(a1)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.values as string[][] | undefined) ?? [];
}

/** Map a sheet's row-array form to KeywordRule[]. Expects headers in row 0:
 *  keyword | code | account_name | priority (order-insensitive; recognised aliases below). */
function rowsToRules(rows: string[][]): KeywordRule[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const kIdx = header.findIndex((h) => /keyword|term|pattern/.test(h));
  const cIdx = header.findIndex((h) => /^code$|coa.?code|account.?code/.test(h));
  const nIdx = header.findIndex((h) => /name|account|description/.test(h));
  const pIdx = header.findIndex((h) => /priority/.test(h));
  if (kIdx < 0 || cIdx < 0) return [];
  const out: KeywordRule[] = [];
  for (const row of rows.slice(1)) {
    const keyword = String(row[kIdx] ?? "").trim();
    const code = String(row[cIdx] ?? "").trim();
    if (!keyword || !code) continue;
    const priorityRaw = pIdx >= 0 ? Number(row[pIdx]) : NaN;
    out.push({
      keyword,
      code,
      account_name: nIdx >= 0 ? String(row[nIdx] ?? "").trim() : code,
      priority: Number.isFinite(priorityRaw) ? priorityRaw : undefined,
    });
  }
  return out;
}

/** Map a settings sheet (key / value rows) to CategoriseSettings. Unknown keys
 *  are ignored. Defaults fill anything missing. */
function rowsToSettings(rows: string[][]): Partial<CategoriseSettings> {
  if (rows.length < 2) return {};
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const kIdx = header.findIndex((h) => /^key$|setting|name/.test(h));
  const vIdx = header.findIndex((h) => /^value$/.test(h));
  if (kIdx < 0 || vIdx < 0) return {};
  const settings: Partial<CategoriseSettings> = {};
  for (const row of rows.slice(1)) {
    const key = String(row[kIdx] ?? "").trim().toLowerCase();
    const valRaw = row[vIdx];
    const num = typeof valRaw === "number" ? valRaw : parseFloat(String(valRaw ?? ""));
    if (Number.isNaN(num)) continue;
    if (key === "match_threshold") settings.match_threshold = num;
    else if (key === "review_threshold") settings.review_threshold = num;
  }
  return settings;
}

/**
 * Loads the COA: Universal rules + industry overlay (if the tab exists) +
 * match-settings. Per the spec: never hard-code, always read live.
 *
 * `industry` is the tab name to load as the overlay — usually the client's
 * primary industry (e.g. "F&B", "Marketing Agency", "Real Estate"). If the
 * tab is missing we silently fall back to Universal only — the categoriser
 * still works, it just loses overlay precedence.
 */
export async function loadCoaSheet(orgId: string | null, runId: string | null, industry: string | null): Promise<{ coa: CoaSheetData; settings: CategoriseSettings; member: string } | { error: string }> {
  const memberId = await getDriveCapableMemberId(orgId, runId);
  if (!memberId) return { error: "No team member has Google connected — connect Google in My Connections so we can read the COA sheet." };
  const token = await getValidGoogleToken(memberId);
  if (!token) return { error: "Could not get a valid Google token. Reconnect Google in My Connections." };

  const industryMatch = resolveIndustryTab(industry);
  const cacheKey = `${COA_SHEET_ID}::${industryMatch?.tab ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { coa: hit.data, settings: hit.settings, member: memberId };
  }

  const universalRows = await readRange(token, COA_SHEET_ID, `${UNIVERSAL_TAB}!A1:Z`);
  const universal = rowsToRules(universalRows);
  let industryRules: KeywordRule[] = [];
  if (industryMatch) {
    const overlayRows = await readRange(token, COA_SHEET_ID, `${industryMatch.tab}!A1:Z`);
    industryRules = rowsToRules(overlayRows);
  }
  const settingsRows = await readRange(token, COA_SHEET_ID, `${SETTINGS_TAB}!A1:Z`);
  const settingsPatch = rowsToSettings(settingsRows);
  // Defaults mirror the Python Match Settings defaults (coa_loader.py).
  const settings: CategoriseSettings = {
    match_threshold: settingsPatch.match_threshold ?? 0.75,
    review_threshold: settingsPatch.review_threshold ?? 0.50,
  };
  const coa: CoaSheetData = { universal, industryOverlay: industryRules, industry: industryMatch?.label ?? undefined };

  cache.set(cacheKey, { at: Date.now(), data: coa, settings });
  return { coa, settings, member: memberId };
}

export function clearCoaCache(): void {
  cache.clear();
}
