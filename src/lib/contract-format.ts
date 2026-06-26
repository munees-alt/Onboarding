/** Formats an engagement period from contract analysis (periodStart / periodEnd, "YYYY-MM").
 *  Used by both the team run view and the onboarding portal so the wording matches everywhere.
 *  - start + end      → "Jan 2026 → Dec 2026"
 *  - start, no end    → "Jan 2026 onwards"   (ongoing / auto-renewing engagement)
 *  - no start, end    → "Until Dec 2026"
 *  - neither          → ""                    (caller decides the fallback)
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(ym?: string | null): string {
  if (!ym) return "";
  const m = /^(\d{4})-(\d{1,2})/.exec(ym.trim());
  if (!m) return ym.trim(); // already plain text (e.g. "January 2026") — keep as-is
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : m[1];
}

export function formatEngagementPeriod(periodStart?: string | null, periodEnd?: string | null): string {
  const start = formatMonth(periodStart);
  const end = formatMonth(periodEnd);
  if (start && end) return `${start} → ${end}`;
  if (start && !end) return `${start} onwards`;
  if (!start && end) return `Until ${end}`;
  return "";
}
