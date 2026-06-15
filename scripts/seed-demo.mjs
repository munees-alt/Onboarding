// Demo data: clients + the Gulf Retail LLC onboarding run on the MEDIUM TEAM
// 7-stage flow (Stage 1 Assign Roles complete, Stage 2 Send Magic Link active).
// Idempotent: clears the prior Gulf Retail client + run first.
// Run: node --env-file=.env.local scripts/seed-demo.mjs
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: org } = await db.from("orgs").select("id").order("created_at").limit(1).single();
const orgId = org.id;

async function memberByRole(role, prefer) {
  if (prefer) {
    const { data } = await db.from("team_members").select("id,full_name").eq("org_id", orgId).eq("full_name", prefer).maybeSingle();
    if (data) return data;
  }
  const { data } = await db.from("team_members").select("id,full_name").eq("org_id", orgId).eq("role", role).eq("is_demo", false).order("sort").limit(1).maybeSingle();
  return data;
}
const am = await memberByRole("admin", "Munees KV");
const senior = await memberByRole("senior");
const junior = await memberByRole("junior");
console.log("AM:", am?.full_name, "| Senior:", senior?.full_name, "| Junior:", junior?.full_name);

// ---- Clean prior demo clients/runs (by slug) -----------------------------
const DEMO_SLUGS = ["gulf-retail-llc", "mena-consulting", "sahara-holdings", "bright-future-trading", "lamar-hospitality", "nova-tech-fze"];
const { data: priorClients } = await db.from("clients").select("id").in("slug", DEMO_SLUGS);
if (priorClients?.length) {
  const ids = priorClients.map((c) => c.id);
  await db.from("onboarding_runs").delete().in("client_id", ids);
  await db.from("clients").delete().in("id", ids);
}

// ---- Clients (spread of statuses) ----------------------------------------
const clients = [
  { slug: "gulf-retail-llc", name: "Gulf Retail LLC", owner_name: "Ahmed Al-Rashidi", industry: "Retail", entity_type: "mainland", status: "onboarding", services: ["bookkeeping","vat","ct"], primary_contact_name: "Ahmed Al-Rashidi", primary_contact_email: "ahmed@gulfretail.ae", phone: "+971 50 123 4567", preferred_channel: "WhatsApp", established_year: 2019, employees: "11-50", revenue_channels: ["Retail","Online"], revenue_bracket: "AED 500k–1M monthly", vat_registered: "Yes", vat_trn: "100234567890003", ct_registered: "Yes", bank_names: ["Emirates NBD"], payment_gateways: ["Telr","Network International"], accounting_software: "Zoho Books", historical_months: "Last 2 years", profile_complete: true },
  { slug: "mena-consulting", name: "Mena Consulting", owner_name: "Layla Haddad", industry: "Professional Services", entity_type: "free_zone", status: "active", services: ["bookkeeping","vat"], primary_contact_email: "layla@menaconsulting.ae", profile_complete: false },
  { slug: "sahara-holdings", name: "Sahara Holdings", owner_name: "Omar Saleh", industry: "Holding Company", entity_type: "offshore", status: "active", services: ["cfo","ct"], primary_contact_email: "omar@sahara.ae", profile_complete: false },
  { slug: "bright-future-trading", name: "Bright Future Trading", owner_name: "Priya Nair", industry: "Trading", entity_type: "mainland", status: "active", services: ["bookkeeping","vat","ct"], primary_contact_email: "priya@brightfuture.ae", profile_complete: true },
  { slug: "lamar-hospitality", name: "Lamar Hospitality", owner_name: "Khalid Anwar", industry: "Hospitality", entity_type: "mainland", status: "active", services: ["bookkeeping","payroll"], primary_contact_email: "khalid@lamar.ae", profile_complete: true },
  { slug: "nova-tech-fze", name: "Nova Tech FZE", owner_name: "Sara Ibrahim", industry: "Technology", entity_type: "free_zone", status: "lead", services: ["bookkeeping"], primary_contact_email: "sara@novatech.ae", profile_complete: false },
];
const idBySlug = {};
for (const c of clients) {
  const { data, error } = await db.from("clients").insert({ org_id: orgId, am_id: c.slug === "gulf-retail-llc" ? am?.id : null, ...c }).select("id").single();
  if (error) throw new Error(`client ${c.slug}: ${error.message}`);
  idBySlug[c.slug] = data.id;
}
console.log(`Clients: ${clients.length}`);
const gulfId = idBySlug["gulf-retail-llc"];

// ---- Onboarding run — MEDIUM TEAM, Stage 2 active ------------------------
const { data: run } = await db.from("onboarding_runs").insert({
  org_id: orgId, client_id: gulfId, am_id: am?.id, status: "in_progress",
  template_key: "medium-team", started_at: "2026-06-02", target_completion: "2026-06-30",
  go_live_date: "2026-06-30", current_stage: 2, progress: 12,
}).select("id").single();
const runId = run.id;

await db.from("run_team").insert([
  am && { run_id: runId, team_member_id: am.id, role_in_run: "am" },
  senior && { run_id: runId, team_member_id: senior.id, role_in_run: "senior" },
  junior && { run_id: runId, team_member_id: junior.id, role_in_run: "junior" },
].filter(Boolean));

// Medium Team stage shape (counts from the template)
const STAGES = [
  { no: 1, name: "Assign Roles", total: 3, status: "complete", done: 3 },
  { no: 2, name: "Send Magic Link", total: 5, status: "active", done: 0 },
  { no: 3, name: "COA Prep · Zoho Books", total: 5, status: "upcoming", done: 0 },
  { no: 4, name: "Call with Client", total: 4, status: "upcoming", done: 0 },
  { no: 5, name: "Catch-up Accounting", total: 2, status: "upcoming", done: 0 },
  { no: 6, name: "Project & Tasks — Internal Team", total: 2, status: "upcoming", done: 0 },
  { no: 7, name: "Handover", total: 5, status: "upcoming", done: 0 },
];
await db.from("run_stages").insert(STAGES.map((s) => ({
  run_id: runId, stage_no: s.no, name: s.name, status: s.status, step_total: s.total, step_done: s.done, sort: s.no,
})));

// Stage-1 steps completed (roles assigned). Other steps default to pending in the view.
await db.from("run_steps").insert([
  { run_id: runId, stage_no: 1, step_no: "t1.1", title: "Run auto-created from template", type: "ai", status: "complete", ai_generated: true, is_approval: false, sort: 0, completed_at: "2026-06-02T08:00:00Z", payload: {} },
  { run_id: runId, stage_no: 1, step_no: "t1.2", title: "Assign Senior Accountant", type: "manual", status: "complete", assignee_id: senior?.id ?? null, ai_generated: false, is_approval: false, sort: 1, completed_at: "2026-06-02T09:00:00Z", payload: { assigned: senior?.full_name ?? null } },
  { run_id: runId, stage_no: 1, step_no: "t1.3", title: "Assign Junior Accountant", type: "manual", status: "complete", assignee_id: junior?.id ?? null, ai_generated: false, is_approval: false, sort: 2, completed_at: "2026-06-02T09:05:00Z", payload: { assigned: junior?.full_name ?? null } },
]);
console.log("Run: Medium Team, Stage 2 active, roles assigned.");

// ---- COA instance (Retail), tasks, docs, drive, handover, magic link -----
await db.from("coa_instances").insert({
  run_id: runId, client_id: gulfId, base_industry: "Retail", status: "draft",
  ai_rationale: "Retail UAE Mainland: VAT registered, multi-channel. Added gateway-fee + clearing accounts for Telr + Network International.",
  accounts: [
    { code: "4001", account: "Retail Sales — Standard Rated", section: "Income", include: true },
    { code: "4002", account: "Retail Sales — Zero Rated", section: "Income", include: true },
    { code: "4003", account: "Online Sales", section: "Income", include: true },
    { code: "5001", account: "Purchases — Standard Rated", section: "Cost of Goods", include: true },
    { code: "6002", account: "Salaries and Wages", section: "Expenses", include: true },
    { code: "6006", account: "Payment Gateway Fees", section: "Expenses", include: true },
    { code: "2001", account: "VAT Payable", section: "Liabilities", include: true },
    { code: "2002", account: "Corporate Tax Payable", section: "Liabilities", include: true },
  ],
});

const tasks = [
  ["Send magic link", am?.id, "Day 1", false, "internal"],
  ["Confirm all details received", senior?.id, "Day 4", true, "client_action"],
  ["Prepare COA", senior?.id, "Day 6", false, "internal"],
  ["Meeting with client", am?.id, "Day 8", true, "milestone"],
  ["Create projects and tasks", am?.id, "Day 16", false, "internal"],
  ["Handover", am?.id, "Day 18", true, "milestone"],
];
await db.from("tasks").insert(tasks.map(([title, who, due, vis, type], i) => ({
  org_id: orgId, run_id: runId, client_id: gulfId, title, due_date: null,
  client_visible: vis, type, status: "not_started", sort: i,
  owner_kind: "team", owner_id: who ?? null, service: due,
})));

const docs = [
  ["Trade licence", "trade_license", "uploaded"], ["Tax certificates", "vat_cert", "uploaded"],
  ["Emirates ID — owners", "emirates_id", "uploaded"], ["Bank statements — last 3–6 months", "bank_statement", "pending"],
  ["MOA", "other", "pending"],
];
await db.from("documents").insert(docs.map(([label, t, status]) => ({
  run_id: runId, client_id: gulfId, label, doc_type: t, status, required: true,
  uploaded_at: status === "uploaded" ? "2026-06-04T10:00:00Z" : null,
})));

await db.from("drive_folders").insert({
  client_id: gulfId,
  tree: { name: "Gulf Retail LLC", children: [
    { name: "Company Documents", children: [{ name: "Tax and Compliance" }, { name: "Company" }] },
    { name: "Books", children: [{ name: "2026", children: [{ name: "June", children: [{ name: "Working Files" }, { name: "Data Received" }] }] }] },
    { name: "Financial Documents", children: [{ name: "Balance Sheet" }, { name: "P&L Statement" }, { name: "AI Summary" }] },
    { name: "Others" },
  ] },
});

const token = crypto.randomBytes(24).toString("base64url");
await db.from("magic_links").insert({
  org_id: orgId, run_id: runId, client_id: gulfId, email: "ahmed@gulfretail.ae",
  token, purpose: "portal", expires_at: "2026-06-30T00:00:00Z",
});
console.log(`Portal magic link: /portal/${token}`);
console.log("\n✓ Demo seed complete (Medium Team flow).");
