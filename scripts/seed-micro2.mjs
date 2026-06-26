// Seeds the "Client Onboarding — Micro 2" template into the DB (runtime reads
// templates from onboarding_templates). Idempotent — upserts by id.
// Flow (per spec): assign team -> contract -> agenda -> deck -> confirm call
// (checklist + recording + notes) -> documents -> intake -> access -> task board
// -> create & share Drive link -> dispatch magic link -> welcome email ->
// catch-up (with opt-out) -> internal project & tasks -> handover (optional).
// Run: node --env-file=.env.local scripts/seed-micro2.mjs
import pg from "pg";

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const T = {
  id: "micro-2",
  name: "Client Onboarding — Micro 2",
  tier: "Micro",
  teamLabel: "Micro team (Team Lead + Senior + Junior)",
  desc: "Lean micro flow: contract & deck, the kickoff call, then portal setup (documents, intake, access, task board, shared Drive) and dispatch, the welcome email, optional catch-up, internal project & tasks, and an optional handover.",
  color: "teal",
  live: true,
  usedBy: 0,
  stages: [
    { id: "x1", name: "Assign Roles", desc: "AM assigns the Team Lead, Senior and Junior who will run this onboarding.", steps: [
      { id: "x1.1", title: "Run auto-created from template", kind: "ai", who: ["System"], pre: true, note: "Created the moment the client was marked signed — the Drive folder is auto-provisioned at the same time." },
      { id: "x1.2", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Owns delivery quality for this client. AM can override the default.", act: { type: "assign", role: "Team Lead" } },
      { id: "x1.3", title: "Assign Senior Accountant", kind: "person", who: ["AM"], note: "Default: most-available senior. AM can override.", act: { type: "assign", role: "Senior" } },
      { id: "x1.4", title: "Assign Junior Accountant", kind: "person", who: ["AM"], note: "Default: most-available junior. AM can override.", act: { type: "assign", role: "Junior" } },
    ] },
    { id: "x2", name: "Contract & Call", desc: "Analyse the contract, prepare the call with an agenda and the branded deck, then hold the kickoff and capture the minutes.", steps: [
      { id: "x2.1", title: "Upload & analyze contract", kind: "doc", who: ["AM", "Senior"], note: "Attach or paste the engagement contract — AI extracts scope, inclusions, exclusions, payment terms and the reports we deliver. Shown to the client in their portal.", act: { type: "contract", btn: "Upload & analyze contract" } },
      { id: "x2.2", title: "Generate & send call agenda (optional)", kind: "ai", who: ["AI", "AM"], note: "Optional — AI drafts a call agenda to send ahead.", act: { type: "agenda", btn: "Generate & send agenda" } },
      { id: "x2.3", title: "Branded onboarding deck", kind: "ai", who: ["AI", "AM"], note: "Auto-generated client-facing deck, scoped from the contract + CRM. Download or present on the call.", act: { type: "deck", btn: "Generate onboarding deck" } },
      { id: "x2.4", title: "Confirm details — kickoff call", kind: "person", who: ["AM", "Senior"], note: "Hold the meeting; tick the coverage checklist and paste the recording link + your notes (used for the welcome email minutes).", act: { type: "call", cover: ["Business model & revenue understood", "Payroll / salary points covered", "Accounting & compliance scope agreed", "Required documents walked through", "Access to be shared agreed", "Open questions logged"] } },
    ] },
    { id: "x3", name: "Onboarding Portal Setup", desc: "Set up the document list, intake form, access requests and task board, create & share the Drive link, then dispatch the onboarding portal link.", steps: [
      { id: "x3.1", title: "Set document upload list", kind: "doc", who: ["Senior"], note: "Mandatory. Standard UAE document set.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "x3.2", title: "Prepare intake form set (optional)", kind: "ai", who: ["AI", "Senior"], note: "OPTIONAL — decide yes/no.", config: "intake", act: { type: "intake", btn: "Prepare intake form", optional: true } },
      { id: "x3.3", title: "Configure system access requests", kind: "person", who: ["Senior"], note: "Choose which systems the client must give us access to (FTA portal, bank, gateways, software…). Each gets a step-by-step SOP in the onboarding portal.", act: { type: "access", btn: "Configure access requests" } },
      { id: "x3.4", title: "Set the client task board", kind: "person", who: ["AM", "Senior"], note: "Mandatory. Toggle what's client-visible.", config: "taskboard", act: { type: "taskboard", btn: "Set client task board" } },
      { id: "x3.5", title: "Create & share client Drive link", kind: "link", who: ["System", "Senior"], note: "Creates the client Drive folder and shares it (editor) with the client and the assigned AM, Team Lead and Senior.", act: { type: "drivelink", btn: "Create & share Drive link", toast: "Drive folder created and shared with the client and team" } },
      { id: "x3.6", title: "Send (or re-send) the onboarding portal link", kind: "link", who: ["AM"], note: "Generates the secure onboarding portal magic link plus ready-to-send email + WhatsApp templates. Use this step to dispatch the link for the first time AND to re-send if the client lost it. Add extra teammate emails who should also be able to open the portal — they're saved to the link and the templates are re-sent to all of them.", act: { type: "dispatch", btn: "Send / re-send portal link" } },
    ], gate: { label: "AM Approval", after: "x3.4", sop: "Review the document list, intake form (if used), access requests and task board, then confirm." } },
    { id: "x4", name: "Welcome", desc: "Send the welcome email — portal link, login steps and the meeting minutes — in one step.", steps: [
      { id: "x4.1", title: "Welcome email — review & send", kind: "ai", who: ["AI", "AM"], note: "Builds the welcome email from the saved template: the client's name, company and portal link are filled in, plus the AI-drafted minutes of the meeting (from your call notes). Review, edit, then send — one step. Dispatch the portal magic link first.", act: { type: "mom", btn: "Generate welcome email" } },
    ] },
    { id: "x4b", name: "Optional Operations", targetDays: 1, optional: true, desc: "Decide if catch-up bookkeeping or urgent compliance is needed. Configure both, then Senior confirms before we move on.", steps: [
      { id: "x4b.1", title: "Catch-up account configuration", kind: "person", who: ["AM"], note: "Decide if the client needs catch-up bookkeeping. If yes, choose the catch-up service scope and assign a Senior to lead it. If no, this step is skipped and we move on.", act: { type: "catchup_config", btn: "Configure catch-up" } },
      { id: "x4b.2", title: "Urgent compliance configuration", kind: "person", who: ["AM"], note: "Decide if there's any urgent compliance (FTA escalation, VAT/CT cleanup, penalties). If yes, choose what's needed and who handles it; we'll spin up a parallel run.", act: { type: "urgent_config", btn: "Configure urgent compliance" } },
      { id: "x4b.3", title: "Senior confirms operational setup complete", kind: "person", who: ["Senior"], approval: { by: "Senior" }, note: "Senior reviews catch-up + urgent-compliance configuration before we proceed.", act: { type: "approve", role: "Senior", btn: "Confirm complete" } },
    ], gate: { label: "Senior confirmation", after: "x4b.3", sop: "Senior signs off the optional operations setup before we move to delivery." } },
    { id: "x5", name: "Catch-up Accounting", desc: "If the client has a backlog, catch-up runs here before go-live. Choose 'no catch-up needed' to skip.", steps: [
      { id: "x5.1", title: "Configure & run catch-up tasks", kind: "person", who: ["Junior"], note: "Decide if catch-up is needed; if not, skip it.", act: { type: "catchup", btn: "Configure catch-up tasks", popup: true, reopen: true } },
      { id: "x5.2", title: "Senior review — confirm all catch-up completed", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Locked until every task on the catch-up board is Done (auto-clears if no catch-up was needed).", act: { type: "approve", btn: "Confirm all completed", role: "Senior", gateOnCatchup: true } },
    ] },
    { id: "x6", name: "Project & Tasks — Internal Team", desc: "The recurring project and tasks created in the PMS for the internal team (link relevant SOPs), then the live workflow diagrams.", steps: [
      { id: "x6.1", title: "Create internal projects & monthly tasks", kind: "person", who: ["AM"], note: "Internal delivery — not shown to the client. Link the SOPs/templates the team should follow.", act: { type: "project", btn: "Create projects & tasks", reopen: true } },
      { id: "x6.2", title: "Build the workflow diagrams", kind: "person", who: ["AM", "Senior"], note: "Map the delivery / monthly-close process.", act: { type: "diagram", btn: "Confirm diagrams built", toast: "Workflow diagrams saved to playbook" } },
    ] },
    { id: "x7", name: "Handover", optional: true, desc: "Optional structured handover to the recurring team: checklist, handover call, then dual sign-off. Recommended, but the run can be completed without it.", steps: [
      { id: "x7.1", title: "Handover checklist", kind: "person", who: ["AM", "Senior"], note: "Confirm everything is in place before the handover call.", act: { type: "checklist", btn: "Checklist complete →", items: ["Access all shared", "Catch-up done (if any)", "Project & tasks created", "Drive shared"] } },
      { id: "x7.2", title: "Handover call to recurring team", kind: "person", who: ["AM", "Senior"], note: "Hold the handover call.", act: { type: "call", memo: true, memoTitle: "Onboarding → Recurring Team" } },
      { id: "x7.3", title: "Sign-off — Onboarding AM", kind: "person", who: ["AM"], note: "The onboarding AM signs off.", act: { type: "approve", role: "Onboarding AM", btn: "Sign off — Onboarding AM", rework: true, reworkSteps: [{ id: "x7.1", title: "Handover checklist" }, { id: "x7.2", title: "Handover call to recurring team" }] } },
      { id: "x7.4", title: "Confirm — Recurring Team Lead", kind: "person", who: ["Senior"], note: "The receiving Team Lead confirms.", act: { type: "approve", role: "Recurring Team Lead", btn: "Confirm — Team Lead", rework: true, reworkSteps: [{ id: "x7.1", title: "Handover checklist" }, { id: "x7.2", title: "Handover call to recurring team" }, { id: "x7.3", title: "Sign-off — Onboarding AM" }] } },
      { id: "x7.5", title: "Mark onboarding complete", kind: "ai", who: ["System"], note: "Closes the run and goes live with the recurring team.", act: { type: "complete", btn: "Onboarding complete — move to Completed", toast: "Onboarding complete — recurring delivery is live" } },
    ], gate: { label: "Both sign-offs in", after: "x7.4" } },
  ],
  intake: [
    { id: "m2-i1", label: "PMS-synced company data", source: "pms", hint: "Name, owner, TRN, entity" },
    { id: "m2-i2", label: "AI business description", source: "ai", hint: "Generated from the email domain" },
    { id: "m2-i3", label: "Primary revenue & expense channels", source: "client" },
    { id: "m2-i4", label: "Preferred contact method", source: "client" },
    { id: "m2-i5", label: "Anything urgent we should know before the call", source: "client" },
  ],
  uploads: [
    { id: "m2-u1", label: "Trade licence", who: "client" },
    { id: "m2-u2", label: "MOA / AOA", who: "client" },
    { id: "m2-u3", label: "Passports / Emirates IDs — owners", who: "client" },
    { id: "m2-u4", label: "CT certificate", who: "client" },
    { id: "m2-u5", label: "VAT certificate (if applicable)", who: "client" },
    { id: "m2-u6", label: "Prior financial statements", who: "client" },
    { id: "m2-u7", label: "Bookkeeping records", who: "client" },
    { id: "m2-u8", label: "Contracts", who: "client" },
  ],
  taskboard: [
    { id: "m2-t1", title: "Kickoff deck presented", owner: "AM", due: "Day 0", clientVisible: true, needsClient: false, chat: [] },
    { id: "m2-t2", title: "Share remaining documents", owner: "Client", due: "Day 2", clientVisible: true, needsClient: true, chat: [] },
    { id: "m2-t3", title: "Grant system access", owner: "Client", due: "Day 2", clientVisible: true, needsClient: true, chat: [] },
    { id: "m2-t4", title: "Sign off onboarding", owner: "Client", due: "Day 7", clientVisible: true, needsClient: true, chat: [] },
  ],
};

const db = await connect();
try {
  await db.query(
    `insert into onboarding_templates (id, name, tier, color, data, updated_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (id) do update set name=excluded.name, tier=excluded.tier, color=excluded.color, data=excluded.data, updated_at=now()`,
    [T.id, T.name, T.tier, T.color, T],
  );
  console.log(`+ upserted template ${T.id} (${T.name})`);
} finally {
  await db.end();
}
console.log("Done.");
