// F01 = Finanshels brand prefix. Code shape: F01-{TLno}-{CoFirst}-{YYMM}
// We never throw on missing data — unknown chunks become "TBD" so the code can
// still be rendered, and the user is nudged to fill the blanks.

export function companyFirstWord(name: string | null | undefined): string {
  if (!name) return "TBD";
  const cleaned = name
    .replace(/\b(llc|fzc|fzco|fz-llc|fz-co|fz|free zone|sole establishment|company|co\.?|ltd\.?|limited|holding|holdings|the|inc\.?|corp\.?)\b/gi, " ")
    .replace(/[^a-z0-9 ]/gi, " ")
    .trim();
  const first = (cleaned.split(/\s+/)[0] || name.trim().split(/\s+/)[0] || "").replace(/[^a-z0-9]/gi, "");
  if (!first) return "TBD";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function tradeLicenceChunk(licence: string | null | undefined): string {
  if (!licence) return "TBD";
  const digits = licence.replace(/[^0-9a-z]/gi, "");
  return digits || "TBD";
}

export function contractStartChunk(date: string | null | undefined): string {
  if (!date) return "TBD";
  // accept YYYY-MM-DD or YYYY-MM
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return "TBD";
  return m[1].slice(2) + m[2]; // YYMM
}

export function buildClientCode(input: {
  tradeLicence: string | null | undefined;
  companyName: string | null | undefined;
  contractStart: string | null | undefined;
}): string {
  return [
    "F01",
    tradeLicenceChunk(input.tradeLicence),
    companyFirstWord(input.companyName),
    contractStartChunk(input.contractStart),
  ].join("-");
}

/** Returns true if the code looks complete (no TBD slots). */
export function isCodeComplete(code: string | null | undefined): boolean {
  return !!code && !/-TBD(-|$)/.test(code);
}
