// Rewrite the catchup template row in onboarding_templates with the new
// expanded 11-stage workflow. Idempotent.
// Run: node --env-file=.env.local scripts/sync-catchup-template.mjs
import pg from "pg";

async function connect() {
  // The direct 5432 host is firewalled on dev machines; the session pooler at
  // :5432 (NOT :6543, which is the txn pooler that can't run DDL) does work
  // and supports the writes we need.
  const candidates = [];
  if (process.env.DATABASE_URL) candidates.push(["DATABASE_URL→session-pooler", process.env.DATABASE_URL.replace(":6543/", ":5432/")]);
  if (process.env.DATABASE_URL) candidates.push(["DATABASE_URL", process.env.DATABASE_URL]);
  if (process.env.DIRECT_URL) candidates.push(["DIRECT_URL", process.env.DIRECT_URL]);
  for (const [name, conn] of candidates) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const CATCHUP = {
  id: "catchup",
  name: "Catch-up Accounting",
  tier: "Catch-up",
  teamLabel: "Dedicated catch-up team (Aarju K + team)",
  desc: "Historical catch-up bookkeeping handled end-to-end: assign team, verify Drive docs + Zoho Vault access, request Zoho account, extract bank + first-pass recon, prep query sheet, build COA, close books, AI review, Team Lead 30-point QA, send final reports.",
  color: "teal",
  live: true,
  usedBy: 0,
  category: "Catch-up",
  stages: [
    { id: "cu1", name: "Assign Roles", desc: "Assign the Team Lead (default: Aarju K) and the team members under her who will work this catch-up.", steps: [
      { id: "cu1.1", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Default: Aarju K (Team Lead — ALC). The AM can override.", act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" } },
      { id: "cu1.2", title: "Assign team members", kind: "person", who: ["Team Lead"], note: "Pick the team members under the assigned Team Lead who will work this catch-up.", act: { type: "assign", role: "Senior", btn: "Assign team members" } },
    ] },
    { id: "cu2", name: "Drive & Verification", desc: "Open the client Drive, cross-check every document and every Zoho Vault access, and draft a message for anything missing.", steps: [
      { id: "cu2.1", title: "Open client Drive folder", kind: "link", who: ["Senior"], note: "The Drive folder is auto-created at client creation. Use this to access it.", act: { type: "drivelink", btn: "Open Drive folder" } },
      { id: "cu2.2", title: "Document checklist (Drive)", kind: "person", who: ["Senior"], note: "Tick each document present in the catch-up Drive folder. Items left unticked feed the missing-items draft message below. You can rename / add / remove items.", act: { type: "checklist", btn: "Documents verified", items: ["Trade Licence", "MOA / AOA", "Bank statements (catch-up period)", "Sales invoices", "Vendor bills", "Contracts (if any)", "Salary sheet (if any)", "Tracker (if any)"] } },
      { id: "cu2.3", title: "Access checklist (Zoho Vault)", kind: "person", who: ["Senior"], note: "Tick each access available in Zoho Vault. Items left unticked feed the missing-items draft message.", act: { type: "checklist", btn: "Access verified", items: ["FTA portal access", "Bank access", "Payment gateway access (if any)", "Other (specify)"] } },
      { id: "cu2.4", title: "Draft message — request the missing items", kind: "ai", who: ["AI", "Senior"], note: "Draft a copy-paste message to the client / internal team listing every unticked document + access. Edit before sending.", act: { type: "catchup_missing", btn: "Draft missing-items message" } },
    ] },
    { id: "cu3", name: "Zoho Account Request", desc: "Draft the message to Lohith to create the client's Zoho account.", steps: [
      { id: "cu3.1", title: "Draft account-creation message to Lohith", kind: "ai", who: ["AI", "Senior"], note: "Draft: 'Hi Lohith, please create an account in Zoho for <company name>. Multi-currency: <yes/no>. Attached: TL and VAT certificate (if any).' Edit, copy, send to Lohith.", act: { type: "zoho_account", btn: "Draft message to Lohith" } },
    ] },
    { id: "cu4", name: "Data Review & Query Sheet", desc: "Extract the bank statements, run a first-pass reconciliation, download Excel, capture queries into a Google Sheet, message the client.", steps: [
      { id: "cu4.1", title: "Bank extraction & first-pass reconciliation", kind: "person", who: ["Senior"], note: "Pulls bank statements from the client's Drive folder (prefers a 'Catch-up' or 'Bank Statements' sub-folder), extracts every line via Klippa, applies the categorisation rules against the live COA Google Sheet, and produces a 5-sheet XLSX (Summary / Raw / Categorised / Needs Review / COA Used). Output is ready for review — never auto-posted.", act: { type: "bankrecon", btn: "Run bank extraction & reconciliation" } },
      { id: "cu4.2", title: "Prepare query sheet (Google Sheets)", kind: "person", who: ["Senior"], note: "Open the query Google Sheet, capture every line item that needs the client's input, then paste the sheet link below for sending.", act: { type: "checklist", btn: "Query sheet ready", items: ["Reviewed the extracted Excel", "Captured every unknown line in the Google Sheet", "Sheet link captured for sending"] } },
      { id: "cu4.3", title: "Draft message — send query sheet to client", kind: "ai", who: ["AI", "Senior"], note: "Draft a message to the client with the query Google Sheet link asking them to resolve the open lines.", act: { type: "catchup_query", btn: "Draft query-sheet message" } },
    ] },
    { id: "cu5", name: "Create COA & Tax Codes", desc: "Build the Chart of Accounts and tax codes (same flow as standard onboarding), then upload every catch-up document to Zoho.", steps: [
      { id: "cu5.1", title: "Build COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited.", act: { type: "coa", btn: "Build COA" } },
      { id: "cu5.2", title: "Upload all documents to Zoho", kind: "person", who: ["Senior"], note: "Confirm every catch-up document has been uploaded to Zoho.", act: { type: "checklist", btn: "Uploaded to Zoho", items: ["Trade Licence uploaded", "MOA uploaded", "Bank statements uploaded", "Invoices uploaded", "Bills uploaded", "Tax certificates uploaded"] } },
    ] },
    { id: "cu6", name: "Reconciliation Progress", desc: "Map how much of the catch-up is done and capture any blockers.", steps: [
      { id: "cu6.1", title: "Track reconciliation progress", kind: "person", who: ["Senior"], note: "Tick each area as it completes and capture any blockers in the run chat.", act: { type: "checklist", btn: "Progress updated", items: ["Bank reconciliation complete", "Invoices reconciled", "Bills reconciled", "Salary / WPS reconciled", "No open blockers"] } },
    ] },
    { id: "cu7", name: "Client Follow-up (optional)", desc: "Send a follow-up query message if more data is needed from the client.", optional: true, steps: [
      { id: "cu7.1", title: "Send follow-up query to client", kind: "ai", who: ["AI", "Senior"], note: "Optional. Draft a follow-up to the client with the latest open queries. Paste the Google Sheet link to include it.", act: { type: "catchup_followup", btn: "Draft follow-up", optional: true } },
    ] },
    { id: "cu8", name: "Close Books", desc: "Team review — confirm the catch-up books are closed before AI / Team Lead review.", steps: [
      { id: "cu8.1", title: "Close books — team review", kind: "person", who: ["Senior"], note: "Team confirms every item is closed before the next review stages.", act: { type: "checklist", btn: "Books closed", items: ["P&L reviewed for anomalies", "Balance sheet ties out", "All schedules attached", "All queries with client resolved or disclosed", "Period locked"] } },
    ] },
    { id: "cu9", name: "AI Review (Claude)", desc: "Run an automated review across the 30 catch-up QA checkpoints — the result is saved here so the Team Lead has it for their final sign-off.", steps: [
      { id: "cu9.1", title: "Run AI review", kind: "ai", who: ["AI"], note: "Generates a structured review across all 30 catch-up QA checkpoints (material flux, cut-offs, schedules, VAT, CT, partner-statement match). Saved here for the Team Lead to read before their sign-off.", act: { type: "catchup_review", btn: "Run AI review" } },
    ] },
    { id: "cu10", name: "Team Lead QA Sign-off", desc: "Team Lead works the 30-point catch-up QA checklist before client dispatch.", steps: [
      { id: "cu10.1", title: "Team Lead QA — 30 checkpoints", kind: "person", who: ["Team Lead"], approval: { by: "Team Lead" }, note: "All 30 QA checkpoints must be reviewed. Capture any issues in the run chat and resolve before sign-off.", act: { type: "checklist", btn: "QA complete — sign off", items: [
        "1. Period Closure — accounting period closed and locked; no post-lock entries without approval",
        "2. Manual Journals — all manual journals reviewed for materiality, narration, support, and approval",
        "3. P&L — current month compared with last 6 months for Revenue, COGS, and Opex",
        "4. P&L Cost Centre-wise — cost centre allocations reviewed and validated against last 6 months",
        "5. P&L Ledger Review — all Revenue, COGS, and Opex ledgers reviewed line by line",
        "6. Revenue Cut-off — revenue recognised in correct accounting period",
        "7. Expense Cut-off & Accruals — expenses and accruals recorded in correct period",
        "8. Balance Sheet — all balances compared with last 6 months and validated",
        "9. Cash & Cash Equivalents — Bank, CC, and PG balances matched with statements",
        "10. Prepayments — balances matched with schedules and amortisation verified",
        "11. Advances & Deposits — employee, vendor, and refundable balances reviewed",
        "12. Inventory — balances matched with system / POS and valuation reviewed",
        "13. Accounts Receivable — AR ageing reviewed and balances >90 days explained",
        "14. Accounts Payable — AP ageing reviewed and balances >90 days explained",
        "15. Fixed Assets — FA balances matched with register and depreciation verified",
        "16. Intangible Assets — intangible balances and amortisation verified",
        "17. Provisions & Other Liabilities — provisions reviewed and supported by workings",
        "18. Loans & Inter-company Accounts — balances matched with agreements and confirmations",
        "19. Suspense & Clearing Accounts — no unexplained balances carried forward",
        "20. Equity & Owner Accounts — capital, drawings, and equity movements reviewed",
        "21. Cash Flow Statement — last 3 months cash flow reviewed against profit",
        "22. Corporate Tax — deductibility readiness review completed for expenses",
        "23. VAT Review — VAT reports matched with P&L, BS, and VAT return",
        "24. Random Sales Invoice Checks — VAT, category, customer, date, MOP, credit notes",
        "25. Random Expense / Bill Checks — VAT, category, supplier, date, MOP, debit notes",
        "26. Partner Statement Review — partner workings matched with books and approved",
        "27. Management / Performance Reports — figures, charts, and narratives validated",
        "28. Flux Analysis — final material variance analysis completed post period lock",
        "29. SOP & working papers updated and uploaded",
        "30. Final QA & sign-off — all issues resolved or disclosed before client dispatch",
      ] } },
    ], gate: { label: "Team Lead sign-off" } },
    { id: "cu11", name: "Send Final Reports", desc: "Share the final catch-up reports with the client and close the run.", steps: [
      { id: "cu11.1", title: "Draft & send catch-up report email", kind: "ai", who: ["AI", "AM"], note: "Drafts the email: P&L, balance sheet, cash flow highlights for the catch-up period. Review, attach reports, send to client.", act: { type: "report", btn: "Draft final report email" } },
      { id: "cu11.2", title: "Confirm reports shared — close catch-up", kind: "person", who: ["AM"], approval: { by: "AM" }, act: { type: "approve", role: "AM", btn: "Confirm sent — close catch-up" } },
    ] },
  ],
  uploads: [
    { id: "cu-u1", label: "Trade Licence", who: "client" },
    { id: "cu-u2", label: "MOA / AOA", who: "client" },
    { id: "cu-u3", label: "Bank statements (catch-up period)", who: "client" },
    { id: "cu-u4", label: "Sales invoices", who: "client" },
    { id: "cu-u5", label: "Vendor bills", who: "client" },
    { id: "cu-u6", label: "Contracts (if any)", who: "client" },
    { id: "cu-u7", label: "Salary sheet (if any)", who: "client" },
    { id: "cu-u8", label: "Tracker (if any)", who: "client" },
  ],
  intake: [],
  taskboard: [],
};

const db = await connect();
try {
  await db.query(
    `insert into onboarding_templates (id, name, tier, color, data, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (id) do update
       set name = excluded.name,
           tier = excluded.tier,
           color = excluded.color,
           data = excluded.data,
           updated_at = now()`,
    [CATCHUP.id, CATCHUP.name, CATCHUP.tier, CATCHUP.color, CATCHUP],
  );
  console.log(`+ catchup template upserted — ${CATCHUP.stages.length} stages, ${CATCHUP.stages.reduce((n, s) => n + s.steps.length, 0)} steps`);
} finally {
  await db.end();
}
console.log("Done.");
