"use server";

// Catch-up template (stage cu4.1) bank extraction + categorisation orchestrator.
// Path 3: external OCR (Klippa via bank-extract.ts) + TS categorisation
// (categorise.ts) + live COA from Google Sheets (google-sheets.ts).
//
// Flow (spec §5):
//   1. List the client's catch-up Drive folder (prefers a sub-folder named
//      "Catch-up" / "Bank Statements"; falls back to all PDFs under the client).
//   2. For each PDF → download → extract → collect normalised rows.
//   3. Load COA + industry overlay + settings from the canonical Google Sheet.
//   4. Categorise every row (rule order per spec, never hard-coded).
//   5. Persist the rows + summary into run_items (kind 'bankrecon'). Step is
//      NOT auto-completed — the team reviews the output and clicks Mark ready.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import {
  getDriveCapableMemberId, getValidGoogleToken, downloadDriveFile,
} from "@/lib/google";
import { extractBankPdf } from "@/lib/bank-extract";
import { loadCoaSheet } from "@/lib/google-sheets";
import { categoriseBatch, type CategorisedRow, type BatchSummary } from "@/lib/categorise";

export interface BankReconResult {
  rows?: CategorisedRow[];
  summary?: BatchSummary;
  source_files?: { id: string; name: string; rowCount: number; error?: string }[];
  generated_at?: string;
  industry?: string | null;
  vendor?: string; // "klippa" | "stub"
  error?: string;
}

// Match bank-statement-looking files under the client folder. We deliberately
// keep this lenient — the team uploads with varied filenames (e.g. "ENBD
// Mar.pdf", "statement_march.csv"). Anything outside this list is ignored to
// avoid sending random PDFs (trade licence, MOA…) to the extractor.
function looksLikeBankStatement(name: string): boolean {
  const n = name.toLowerCase();
  if (!/\.(pdf|csv|xlsx?|xls)$/.test(n)) return false;
  if (/(licence|license|moa|aoa|emirates.?id|passport|trn|certificate)/.test(n)) return false;
  return /(bank|statement|enbd|adcb|fab|mashreq|dib|rak|cbd|account)/.test(n) || /\bstmt\b/.test(n);
}

async function listChildrenByName(token: string, parentId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return [];
  return (await r.json()).files ?? [];
}

// Find a sub-folder by case-insensitive name match.
function findSubFolder(children: { id: string; name: string; mimeType: string }[], wanted: string[]): string | null {
  for (const c of children) {
    if (c.mimeType !== "application/vnd.google-apps.folder") continue;
    const lc = c.name.toLowerCase();
    if (wanted.some((w) => lc.includes(w))) return c.id;
  }
  return null;
}

async function collectBankFiles(token: string, clientFolderId: string): Promise<{ id: string; name: string }[]> {
  // Look one level down for a "Catch-up" or "Bank Statements" folder; if found,
  // only its files are used. Otherwise scan the client folder itself.
  const topChildren = await listChildrenByName(token, clientFolderId);
  const catchupId = findSubFolder(topChildren, ["catch-up", "catchup", "catch up"]);
  const stmtId = findSubFolder(topChildren, ["bank statement", "bank statements", "statements"]);
  const scanFolders = [catchupId, stmtId, !catchupId && !stmtId ? clientFolderId : null].filter((x): x is string => !!x);
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const f of scanFolders) {
    const kids = f === clientFolderId ? topChildren : await listChildrenByName(token, f);
    for (const k of kids) {
      if (k.mimeType === "application/vnd.google-apps.folder") {
        // Also descend one extra level under a catchup/statements folder so
        // statements grouped by month or bank still get picked up.
        if (f === catchupId || f === stmtId) {
          for (const kk of await listChildrenByName(token, k.id)) {
            if (kk.mimeType !== "application/vnd.google-apps.folder" && looksLikeBankStatement(kk.name) && !seen.has(kk.id)) {
              out.push({ id: kk.id, name: kk.name }); seen.add(kk.id);
            }
          }
        }
        continue;
      }
      if (looksLikeBankStatement(k.name) && !seen.has(k.id)) {
        out.push({ id: k.id, name: k.name }); seen.add(k.id);
      }
    }
  }
  return out;
}

export async function runBankReconForCatchup(
  runId: string,
  stepId: string,
): Promise<BankReconResult> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("client_id, clients(id, name, industry, org_id)")
    .eq("id", runId)
    .maybeSingle();
  type ClientRow = { id: string; name: string; industry: string | null; org_id: string };
  const client = run ? (Array.isArray(run.clients) ? run.clients[0] : run.clients) as ClientRow | null : null;
  if (!client) return { error: "Client not found for this run." };

  // 1. Client Drive folder id (stored at client creation in drive_folders.tree.id).
  const { data: df } = await supabase
    .from("drive_folders")
    .select("tree")
    .eq("client_id", client.id)
    .maybeSingle();
  const folderId = (df?.tree as { id?: string } | null)?.id;
  if (!folderId) return { error: "No Drive folder is linked to this client yet — create one in the Drive step first." };

  const memberId = await getDriveCapableMemberId(session.profile.org_id, runId);
  if (!memberId) return { error: "No team member has Google connected. Connect Google in My Connections to read the Drive files." };
  const token = await getValidGoogleToken(memberId);
  if (!token) return { error: "Google token expired and could not be refreshed. Reconnect in My Connections." };

  // 2. Collect bank-statement files.
  const files = await collectBankFiles(token, folderId);
  if (!files.length) {
    return { error: "No bank statements found under the client's Drive folder. Upload them under a 'Catch-up' or 'Bank Statements' sub-folder, or directly under the client folder." };
  }

  // 3. Extract every file via the vendor adapter (Klippa or stub).
  const sourceFiles: NonNullable<BankReconResult["source_files"]> = [];
  const allRows = [];
  let vendor = "klippa";
  for (const f of files) {
    const bytes = await downloadDriveFile(memberId, f.id);
    if (!bytes) { sourceFiles.push({ id: f.id, name: f.name, rowCount: 0, error: "Could not download" }); continue; }
    const ex = await extractBankPdf(bytes, f.name);
    if ("error" in ex) { sourceFiles.push({ id: f.id, name: f.name, rowCount: 0, error: ex.error }); continue; }
    if (ex.bank?.toLowerCase().includes("stub")) vendor = "stub";
    sourceFiles.push({ id: f.id, name: f.name, rowCount: ex.rows.length });
    allRows.push(...ex.rows);
  }
  if (!allRows.length) {
    return { error: "Extracted 0 transactions. Check the files are real bank statements and that the Klippa key is set (KLIPPA_API_KEY in .env).", source_files: sourceFiles };
  }

  // 4. COA + settings (industry overlay tab named after client.industry).
  const coaLoad = await loadCoaSheet(session.profile.org_id, runId, client.industry);
  if ("error" in coaLoad) return { error: coaLoad.error, source_files: sourceFiles };
  const { coa, settings } = coaLoad;

  // 5. Categorise.
  const { rows, summary } = categoriseBatch(allRows, coa, settings);

  // 6. Persist to run_items (kind 'bankrecon'). Replace any prior result on the
  // same step — re-running is the standard "I uploaded a new statement" workflow.
  const admin = createAdminClient();
  await admin.from("run_items").delete().eq("run_id", runId).eq("kind", "bankrecon");
  const result: BankReconResult = {
    rows, summary, source_files: sourceFiles,
    generated_at: new Date().toISOString(),
    industry: client.industry ?? null,
    vendor,
  };
  await admin.from("run_items").insert({
    run_id: runId,
    kind: "bankrecon",
    data: { stepId, ...result },
    status: "open",
  });
  return result;
}

/** Read the last bank-recon result so the modal can render it without
 *  re-running extraction (which costs money on Klippa). */
export async function getBankReconResult(runId: string): Promise<BankReconResult | null> {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("run_items")
    .select("data")
    .eq("run_id", runId)
    .eq("kind", "bankrecon")
    .maybeSingle();
  if (!data?.data) return null;
  return data.data as BankReconResult;
}

/** Mark the bank-recon step ready for review — completes the step in Cadence's
 *  existing model (we don't have a dedicated 'ready_for_review' status; the
 *  team's confirmation is the human approval gate the spec asks for). */
export async function confirmBankReconReady(runId: string, stepId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const { completeStep } = await import("./actions");
  return completeStep(runId, stepId);
}
