import "server-only";
import type { NormalisedTxn } from "./categorise";

// Vendor-agnostic interface for the bank-statement → normalised-rows step.
// Path 3 (chosen 2026-06-29): we outsource OCR/parsing to a specialist vendor
// (Klippa first) and keep the categorisation logic in TS. This file is the ONLY
// place that talks to the vendor — swap the implementation, the rest of the
// app doesn't change.

export interface ExtractResult {
  rows: NormalisedTxn[];
  /** Bank name guessed by the vendor (Emirates NBD, ADCB, …) — informational. */
  bank?: string;
  /** Currency reported by the vendor — falls back to AED. */
  currency?: string;
  /** Statement period reported by the vendor, if any. */
  period?: { start?: string; end?: string };
  /** Pages processed (informational, for cost tracking). */
  pages?: number;
}

export interface ExtractError {
  error: string;
}

/** Convenience: load the Klippa key from env. Kept here so callers don't need
 *  to know how the key is provisioned (env today, possibly Settings UI later). */
function getKlippaKey(): string | null {
  return process.env.KLIPPA_API_KEY?.trim() || null;
}

/**
 * Extract a single bank-statement PDF (or CSV/Excel — handled by the vendor)
 * into the normalised schema. The implementation is split:
 *
 *  - If KLIPPA_API_KEY is set → call Klippa's bank-statement endpoint.
 *  - Else → return a STUB result with one demo row, so the rest of the catchup
 *    flow (UI, modal, run_items persistence) can be developed and click-tested
 *    end-to-end before the live integration is enabled.
 *
 * Vendor swap: change ONLY this file. Everything downstream (categoriser,
 * orchestrator, modal) is unaware of the source.
 */
export async function extractBankPdf(
  fileBytes: Buffer,
  filename: string,
): Promise<ExtractResult | ExtractError> {
  const key = getKlippaKey();
  if (!key) return stubExtract(filename);
  return klippaExtract(fileBytes, filename, key);
}

// ─────────────────────────────────────────────────────────────────────────────
// STUB — keeps the full flow runnable before the user pastes a Klippa key.
// Generates a small set of realistic UAE-shaped lines so the categoriser,
// preview modal, summary, and Excel-output paths can all be eyeballed.

function stubExtract(filename: string): ExtractResult {
  const today = new Date().toISOString().slice(0, 10);
  const day = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const rows: NormalisedTxn[] = [
    { txn_date: day(28), description: "WPS PAYROLL BATCH MAR-2026", debit: 47_500.00, credit: 0, currency: "AED", source_file: filename, source_row: 1 },
    { txn_date: day(25), description: "TRANSFER FROM OWN ACCOUNT EMIRATES NBD", debit: 0, credit: 25_000.00, currency: "AED", source_file: filename, source_row: 2 },
    { txn_date: day(22), description: "BANK CHARGES MAR-2026", debit: 105.00, credit: 0, currency: "AED", source_file: filename, source_row: 3 },
    { txn_date: day(18), description: "PAYMENT FROM CLIENT ACME TRADING LLC INV-1042", debit: 0, credit: 12_500.00, currency: "AED", source_file: filename, source_row: 4 },
    { txn_date: day(15), description: "FTA VAT PAYMENT Q4-2025", debit: 8_320.00, credit: 0, currency: "AED", source_file: filename, source_row: 5 },
    { txn_date: day(10), description: "RENT MARCH - DUBAI DIGITAL PARK FZE", debit: 18_000.00, credit: 0, currency: "AED", source_file: filename, source_row: 6 },
    { txn_date: day(7), description: "ETISALAT MAR-2026", debit: 612.50, credit: 0, currency: "AED", source_file: filename, source_row: 7 },
    { txn_date: day(3), description: "DEWA UTILITIES MAR-2026", debit: 1_245.00, credit: 0, currency: "AED", source_file: filename, source_row: 8 },
    { txn_date: today, description: "INTEREST CREDIT", debit: 0, credit: 18.40, currency: "AED", source_file: filename, source_row: 9 },
  ];
  return { rows, bank: "Stub (no Klippa key set)", currency: "AED", pages: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// KLIPPA — bank-statement endpoint. Klippa's "Financial document parser" has a
// dedicated bank-statement template that returns transactions in a normalised
// shape. Their API is auth-by-header + multipart upload + sync JSON response
// for small files. Larger files use their async pickup pattern.
//
// We keep this implementation deliberately minimal — one POST, one shape, no
// SDK. The user must supply KLIPPA_API_KEY in .env (NEXT_PUBLIC not required).

const KLIPPA_BASE = process.env.KLIPPA_API_BASE || "https://custom-ocr.klippa.com/api/v1";
const KLIPPA_TEMPLATE = process.env.KLIPPA_BANK_TEMPLATE || "bank_statement";

interface KlippaTxn {
  date?: string;
  value_date?: string;
  description?: string;
  amount_debit?: number;
  amount_credit?: number;
  balance?: number;
  currency?: string;
}

interface KlippaResponse {
  data?: {
    bank?: string;
    currency?: string;
    period_start?: string;
    period_end?: string;
    transactions?: KlippaTxn[];
    pages?: number;
  };
  error?: string;
}

async function klippaExtract(
  fileBytes: Buffer,
  filename: string,
  apiKey: string,
): Promise<ExtractResult | ExtractError> {
  const form = new FormData();
  // Klippa accepts the file as 'document' on their parse endpoint. The exact
  // template is set via 'template' (or a separate URL path depending on the
  // plan). Adjust here if the user's Klippa contract uses a different shape.
  const blob = new Blob([new Uint8Array(fileBytes)], { type: "application/pdf" });
  form.append("document", blob, filename);
  form.append("template", KLIPPA_TEMPLATE);

  let res: Response;
  try {
    res = await fetch(`${KLIPPA_BASE}/parseDocument`, {
      method: "POST",
      headers: { "X-Auth-Key": apiKey },
      body: form,
    });
  } catch (e: unknown) {
    return { error: `Klippa request failed: ${(e as Error)?.message || "unknown"}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Klippa ${res.status}: ${text.slice(0, 240)}` };
  }
  const j: KlippaResponse = await res.json().catch(() => ({}));
  if (!j.data || !Array.isArray(j.data.transactions)) {
    return { error: "Klippa returned no transactions. Check the file is a bank statement and the template is right." };
  }
  const rows: NormalisedTxn[] = j.data.transactions.map((t, i) => ({
    txn_date: isoDate(t.date) || "",
    value_date: isoDate(t.value_date),
    description: (t.description || "").trim(),
    debit: positive(t.amount_debit),
    credit: positive(t.amount_credit),
    balance: typeof t.balance === "number" ? t.balance : undefined,
    currency: (t.currency || j.data?.currency || "AED").toUpperCase(),
    source_file: filename,
    source_row: i + 1,
  })).filter((r) => r.txn_date && (r.debit > 0 || r.credit > 0));

  return {
    rows,
    bank: j.data.bank,
    currency: j.data.currency || "AED",
    period: { start: j.data.period_start, end: j.data.period_end },
    pages: j.data.pages,
  };
}

function positive(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.abs(n);
}

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // Accept "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY".
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return undefined;
}
