// Faithful port of the prototype's onboarding templates engine (OB_TPL).
// Three editable flows. The run view + hub Templates tab render from this.

export type StepKind = "ai" | "person" | "link" | "doc" | "check";
export type WhoToken =
  | "System" | "AI" | "Client" | "Ops" | "AM" | "Team Lead" | "Senior" | "Junior";

export interface StepAct {
  type: string;
  btn?: string;
  role?: string;
  options?: string[];
  def?: string;
  optional?: boolean;
  toast?: string;
  reopen?: boolean;
  popup?: boolean;
  contract?: boolean;
  /** Dispatch step variant: when true, generate the PUBLIC NO-LOGIN intake link
      (/intake/<token>) instead of the OTP-gated onboarding portal link. */
  intake?: boolean;
  items?: string[];
  cover?: string[];
  memo?: boolean;
  memoTitle?: string;
  gateOnCatchup?: boolean;
  rework?: boolean;
  reworkSteps?: { id: string; title: string }[];
}
export interface TemplateStep {
  id: string;
  title: string;
  kind: StepKind;
  who: WhoToken[];
  note?: string;
  pre?: boolean;
  config?: string;
  approval?: { by: string };
  act?: StepAct;
  assignRole?: string; // overrides the stage default (am | team_lead | senior | junior | intern)
}
export interface TemplateGate {
  label: string;
  after?: string;
  sop?: string;
}
export interface TemplateStage {
  id: string;
  name: string;
  desc: string;
  steps: TemplateStep[];
  gate?: TemplateGate;
  assignRole?: string; // default assignee role for all steps in this stage
  optional?: boolean; // optional stage (e.g. Handover) — does not block run completion
  targetDays?: number; // SLA: stage should complete within this many days of starting
}

// Roles assignable to a stage/step, in hierarchy order (AM → Lead → Senior → Junior → Intern).
export const ASSIGN_ROLES: { id: string; label: string }[] = [
  { id: "am", label: "Account Manager" },
  { id: "team_lead", label: "Team Lead" },
  { id: "senior", label: "Senior" },
  { id: "junior", label: "Junior" },
  { id: "intern", label: "Intern" },
];
export function effectiveRole(stage: TemplateStage, step: TemplateStep): string | null {
  return step.assignRole ?? stage.assignRole ?? null;
}
export interface OnbTemplate {
  id: string;
  name: string;
  tier: string;
  teamLabel: string;
  desc: string;
  color: string;
  live: boolean;
  usedBy: number;
  category?: string; // department: Onboarding | Accounting | Taxation | Auditing (defaults to Onboarding)
  event?: string; // e.g. "onboarding" — top-level grouping shown in the Templates section
  flow?: string; // e.g. "client-onboarding-master" — which flow this template belongs to
  industry?: string; // set only for industry-specific variants; omitted = applies to any industry
  stages: TemplateStage[];
  intake: { id: string; label: string; source: string; hint?: string; suggested?: boolean }[];
  uploads: { id: string; label: string; who: string; suggested?: boolean }[];
  taskboard: {
    id: string; title: string; owner: string; due: string;
    clientVisible: boolean; needsClient: boolean; approval?: string;
    chat: { who: string; text: string; t: string }[];
  }[];
}

const MEDIUM_ENTERPRISE: OnbTemplate = {
  id: "medium-enterprise", name: "Medium Enterprise", tier: "Enterprise",
  teamLabel: "Enterprise team (AM + Senior + Junior + Ops)",
  desc: "Full 8-stage onboarding for established SMEs — historical migration, multi-channel revenue, WPS payroll and enforced handover.",
  color: "orange", live: true, usedBy: 1,
  stages: [
    { id: "e1", name: "Trigger and Team Setup", desc: "CRM trigger fires the run, Ops assigns the team, scope email and Drive folder auto-created.", steps: [
      { id: "e1.1", title: "Client marked Signed — run auto-created", kind: "ai", who: ["System"] },
      { id: "e1.2", title: "Ops Manager assigns team (AM · Senior · Junior)", kind: "person", who: ["Ops"] },
      { id: "e1.3", title: "Scope confirmation email auto-sent", kind: "ai", who: ["System"] },
      { id: "e1.4", title: "Drive folder auto-created", kind: "link", who: ["System"] },
    ] },
    { id: "e2", name: "Pre-Fill and Form Dispatch", desc: "AM pre-fills the intake form from CRM, reviews, approves — magic link goes to the client.", steps: [
      { id: "e2.1", title: "System pre-fills intake form from CRM", kind: "ai", who: ["System"] },
      { id: "e2.2", title: "AM reviews, edits and approves form", kind: "person", who: ["AM"] },
      { id: "e2.3", title: "Magic link dispatched to client", kind: "link", who: ["System"] },
    ], gate: { label: "AM Approval", after: "e2.2" } },
    { id: "e3", name: "Client Data Collection", desc: "Client confirms the pre-filled form, adds what's missing, uploads documents.", steps: [
      { id: "e3.1", title: "AM reviews submitted data", kind: "person", who: ["AM"] },
    ] },
    { id: "e4", name: "Drive Prep and Pre-Call", desc: "Team organises documents, prepares the COA, generates the AI pre-call brief.", steps: [
      { id: "e4.1", title: "AI pre-call brief generated", kind: "ai", who: ["AI"] },
      { id: "e4.2", title: "AM reviews AI brief", kind: "person", who: ["AM"] },
      { id: "e4.3", title: "COA template auto-selected", kind: "ai", who: ["AI"] },
      { id: "e4.4", title: "Senior Accountant adjusts COA", kind: "person", who: ["Senior"], approval: { by: "AM" } },
      { id: "e4.5", title: "Agenda auto-generated and sent", kind: "ai", who: ["System"] },
    ], gate: { label: "AM Approval", after: "e4.2" } },
    { id: "e5", name: "Kickoff Call", desc: "Strategic conversation. Logistics handled, COA reviewed, scope confirmed.", steps: [
      { id: "e5.1", title: "Call scheduled", kind: "person", who: ["AM"] },
      { id: "e5.2", title: "Kickoff call conducted (Fathom records)", kind: "person", who: ["AM"] },
      { id: "e5.2b", title: "Cross-sell checklist — what else does this client need?", kind: "person", who: ["AM"], note: "Tick every additional service the client is likely to need. Each ticked item is captured for follow-up — don't sell on the call.", act: { type: "checklist", btn: "Cross-sell captured", items: ["Statutory audit (revenue > AED 50M or required by free zone)", "Salary benchmarking — owner / executive comp review", "VAT registration (estimated taxable revenue > AED 375K)", "Corporate Tax registration (every UAE entity)", "Prior-period catch-up bookkeeping", "AML / UBO compliance (DNFBP — real estate / brokers / dealers)"] } },
      { id: "e5.3", title: "Post-call structured notes submitted", kind: "doc", who: ["AM"] },
      { id: "e5.4", title: "Confirm accounting software", kind: "person", who: ["AM", "Senior"], note: "Record which accounting software we'll run this client on (Zoho Books, QuickBooks, Xero, Odoo…). Saved to the client and shown in the playbook → Tools & Access.", act: { type: "accountingsoftware", btn: "Set accounting software" } },
    ] },
    { id: "e6", name: "Post-Call and COA Sign-Off", desc: "Welcome email drafted, COA sent to client in plain English, playbook finalised.", steps: [
      { id: "e6.1", title: "Welcome email auto-drafted", kind: "ai", who: ["System"] },
      { id: "e6.2", title: "COA sent to client for review", kind: "link", who: ["System"] },
      { id: "e6.3", title: "Client signs off COA", kind: "person", who: ["Client"] },
    ], gate: { label: "AM Approval" } },
    { id: "e7", name: "Task Board Configuration", desc: "Full project + task structure built and confirmed. Client sees milestone view.", steps: [
      { id: "e7.1", title: "Task list auto-generated from template", kind: "ai", who: ["System"] },
      { id: "e7.2", title: "Team configures tasks + due dates", kind: "person", who: ["AM"] },
      { id: "e7.3", title: "Client-visible toggles set per task", kind: "person", who: ["AM"] },
      { id: "e7.4", title: "Generate onboarding one-pager", kind: "person", who: ["AM"], note: "Polished one-pager summarising the compliance calendar, first delivery date, team contacts and UAE compliance details. Share with the client before recurring delivery kicks off.", act: { type: "onepager", btn: "Generate one-pager" } },
    ] },
    { id: "e8", name: "Handover", optional: true, desc: "Optional structured handover. Recommended for a clean transition, but the run can be completed without it.", steps: [
      { id: "e8.1", title: "Handover checklist auto-generated", kind: "ai", who: ["System"] },
      { id: "e8.2", title: "AM completes checklist", kind: "person", who: ["AM"] },
      { id: "e8.3", title: "Regular team confirms receipt", kind: "person", who: ["Senior"] },
    ], gate: { label: "AM Approval" } },
  ],
  intake: [
    { id: "me-i1", label: "Company & owner details", source: "pms" },
    { id: "me-i2", label: "Business description", source: "ai", hint: "Drafted from the email domain" },
    { id: "me-i3", label: "Revenue channels", source: "client" },
    { id: "me-i4", label: "Bank & payment gateways", source: "client" },
    { id: "me-i5", label: "Accounting software & historical months", source: "client" },
    { id: "me-i6", label: "VAT / CT registration & TRN", source: "pms" },
    { id: "me-i7", label: "Employee count & WPS", source: "client" },
  ],
  uploads: [
    { id: "me-u1", label: "Trade licence", who: "client" },
    { id: "me-u2", label: "VAT / Tax certificate", who: "client" },
    { id: "me-u3", label: "Emirates ID — owners", who: "client" },
    { id: "me-u4", label: "Bank statements — last 3 months", who: "client" },
    { id: "me-u5", label: "Accounting software export", who: "client" },
  ],
  taskboard: [
    { id: "me-t1", title: "Collect all client documents", owner: "AM", due: "10 Jun", clientVisible: false, needsClient: true, chat: [] },
    { id: "me-t2", title: "Accounting export and review", owner: "Senior", due: "12 Jun", clientVisible: false, needsClient: false, chat: [] },
    { id: "me-t3", title: "COA setup", owner: "Senior", due: "14 Jun", clientVisible: false, needsClient: false, chat: [] },
    { id: "me-t4", title: "COA client review and sign-off", owner: "Client", due: "16 Jun", clientVisible: true, needsClient: true, chat: [] },
    { id: "me-t5", title: "Historical data migration", owner: "Junior", due: "20 Jun", clientVisible: false, needsClient: false, chat: [] },
    { id: "me-t6", title: "Go-live confirmation", owner: "Client", due: "30 Jun", clientVisible: true, needsClient: true, chat: [] },
  ],
};

const MEDIUM_TEAM: OnbTemplate = {
  id: "medium-team", name: "Medium Team", tier: "Team",
  teamLabel: "Medium team (Senior + Junior, AM oversight)",
  desc: "Streamlined onboarding for smaller teams — role assignment, magic-link intake, senior-led COA prep with AM sign-off, kickoff call with AI minutes, catch-up and handover.",
  color: "blue", live: true, usedBy: 0,
  stages: [
    { id: "t1", name: "Assign Roles", targetDays: 1, desc: "AM assigns the Team Lead, Senior and Junior who will run this onboarding. Defaults pre-selected from the team roster.", steps: [
      { id: "t1.1", title: "Run auto-created from template", kind: "ai", who: ["System"], pre: true, note: "Created the moment the client was marked signed." },
      { id: "t1.1b", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Owns delivery quality for this client. AM can override the default.", act: { type: "assign", role: "Team Lead" } },
      { id: "t1.2", title: "Assign Senior Accountant", kind: "person", who: ["AM"], note: "Default: most-available senior. AM can override.", act: { type: "assign", role: "Senior" } },
      { id: "t1.3", title: "Assign Junior Accountant", kind: "person", who: ["AM"], note: "Optional — a junior isn't always needed. Skip and the stage still completes.", act: { type: "assign", role: "Junior", optional: true } },
    ] },
    { id: "t2", name: "Send Magic Link", targetDays: 2, desc: "Prepare the document upload list and the task board — then dispatch (or re-send) the onboarding portal link.", steps: [
      { id: "t2.0a", title: "Upload contract & confirm deliverables", kind: "doc", who: ["AM", "Senior"], note: "Attach or paste the engagement contract — AI extracts the scope, exclusions, payment terms and the reports we deliver (with timelines). Shown to the client in their portal Live tab.", act: { type: "contract", btn: "Upload & analyze contract" } },
      { id: "t2.2", title: "Set document upload list", kind: "doc", who: ["Senior"], note: "Mandatory. Trade licence, tax certificates, MOA, owner EIDs/passports, trackers.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "t2.2b", title: "Configure all access & tools", kind: "person", who: ["Senior"], note: "The single step where we lock in every system the team will use for this client AND the access the client needs to grant. Tick each tool (accounting software, banks, payment gateways, FTA portal, payroll) and add the team emails the access should be shared with. Each gets a step-by-step SOP in the onboarding portal.", act: { type: "access", btn: "Configure all access & tools" } },
      { id: "t2.3", title: "Set the client task board", kind: "person", who: ["AM", "Senior"], note: "Mandatory. The board the client sees in their portal — toggle what's client-visible.", config: "taskboard", act: { type: "taskboard", btn: "Set client task board" } },
      { id: "t2.4", title: "Create & share client Drive link", kind: "link", who: ["System", "Senior"], note: "The Drive folder is auto-created when onboarding starts. Generate the shareable link — saved to the run and sent with the magic link.", act: { type: "drivelink", btn: "Create & share Drive link", toast: "Drive link created and shared with the client" } },
      { id: "t2.4b", title: "Send (or re-send) the onboarding portal link", kind: "link", who: ["AM"], note: "Generates the secure onboarding portal magic link plus ready-to-send email + WhatsApp templates. Use this step to dispatch the link for the first time AND to re-send if the client lost it. Add extra teammate emails who should also be able to open the portal — they're saved to the link and the templates are re-sent to all of them.", act: { type: "dispatch", btn: "Send / re-send portal link" } },
    ], gate: { label: "AM Approval", after: "t2.3", sop: "Review the document list and the client task board, then confirm before the magic link is dispatched." } },
    { id: "t4", name: "Call with Client", targetDays: 7, desc: "Optional AI agenda sent ahead, then the client meeting covering scope and needs. AI generates the minutes of meeting from the recording.", steps: [
      { id: "t4.0", title: "Generate & send call agenda (optional)", kind: "ai", who: ["AI", "AM"], note: "Optional — AI drafts a call agenda from the intake + brief. Review and send before the call.", act: { type: "agenda", btn: "Generate & send agenda" } },
      { id: "t4.1", title: "Meeting — client discussion & scope alignment", kind: "person", who: ["AM", "Senior"], note: "Hold the client meeting. Cross off each coverage point, then add the recording link and your notes.", act: { type: "call", cover: ["Business model & revenue understood", "Payroll / salary points covered", "Accounting & compliance scope agreed", "Required documents walked through", "Open questions logged"] } },
      { id: "t4.1b", title: "Cross-sell checklist — what else does this client need?", kind: "person", who: ["AM"], note: "Tick every additional service the client is likely to need. Each ticked item becomes a flagged lead the AM can convert later — don't sell on the call, just capture.", act: { type: "checklist", btn: "Cross-sell captured", items: ["Statutory audit (revenue > AED 50M or required by free zone)", "Salary benchmarking — owner / executive comp review", "VAT registration (estimated taxable revenue > AED 375K)", "Corporate Tax registration (every UAE entity)", "Prior-period catch-up bookkeeping", "AML / UBO compliance (DNFBP — real estate / brokers / dealers)"] } },
      { id: "t4.2", title: "Welcome email — review & send", kind: "ai", who: ["AI", "AM"], note: "Builds the welcome email from the saved template: the client's name, company and portal link are filled in, plus the AI-drafted minutes of the meeting (from your call notes). Review, edit, then send — one step. Dispatch the portal magic link first.", act: { type: "mom", btn: "Generate welcome email" } },
      { id: "t4.3", title: "Confirm accounting software", kind: "person", who: ["AM", "Senior"], note: "Record which accounting software we'll run this client on (Zoho Books, QuickBooks, Xero, Odoo…). Saved to the client and shown in the playbook → Tools & Access.", act: { type: "accountingsoftware", btn: "Set accounting software" } },
    ] },
    { id: "t3", name: "COA Prep · Zoho Books", targetDays: 5, desc: "Senior Accountant prepares the chart of accounts and sets up Zoho Books. AM signs off before it goes to the client.", steps: [
      { id: "t3.1", title: "Client data received — checklist", kind: "person", who: ["Senior"], note: "Cross off each item before COA prep. Attach the engagement contract to auto-detect any catch-up backlog.", act: { type: "checklist", btn: "Confirm received", contract: true, items: ["Documents all collected", "Intake form completed", "Registrations confirmed (CT / VAT / WPS)", "Bank statements received"] } },
      { id: "t3.1b", title: "Urgent compliance triage", kind: "person", who: ["AM", "Senior"], note: "Flag penalty-risk items (CT / VAT / WPS / AML). For each, pick a person — it lands in their My Work with the task template ready.", act: { type: "triage", btn: "Assign urgent items" } },
      { id: "t3.2", title: "Prepare COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited and sent to the AM for review.", act: { type: "coa", btn: "Build COA" } },
      { id: "t3.2b", title: "Confirm tax codes", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Generates the UAE baseline + industry overlay (VAT 5% / 0% / exempt / RCM, Corporate Tax 0% / 9%) plus AI-suggested industry-specific codes. Edit and export.", act: { type: "taxcodes", btn: "Build tax codes" } },
      { id: "t3.3", title: "Set up Zoho Books & import COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Connect Zoho Books, import the approved COA and confirm.", act: { type: "zoho", btn: "Import COA into Zoho" } },
      { id: "t3.4", title: "Create compliance calendar", kind: "ai", who: ["AI", "Senior"], note: "Auto-populated from filing due dates (VAT, CT, WPS) and document expiries. Review, edit or add.", act: { type: "calendar", btn: "Create compliance calendar", reopen: true } },
    ], gate: { label: "AM Approval", after: "t3.4", sop: "Review the COA numbering, Zoho import and compliance calendar, then approve." } },
    { id: "t4b", name: "Optional Operations", targetDays: 1, optional: true, desc: "Decide if catch-up bookkeeping or urgent compliance is needed. Catch-up + urgent compliance both route to Gautham (Tax Head). Senior confirms before we move on.", steps: [
      { id: "t4b.1", title: "Catch-up — configure & assign", kind: "person", who: ["AM"], note: "Decide yes/no. If yes, we spin up a parallel catch-up run assigned to Gautham (the only AM allowed to own catch-up). If no, this step is marked complete and we move on.", act: { type: "catchup_config", btn: "Configure catch-up" } },
      { id: "t4b.2", title: "Urgent compliance — configure & assign", kind: "person", who: ["AM"], note: "Is there any urgent compliance to handle? Pick yes/no. If yes, choose the services needed (CT Registration, VAT Registration, CT Filing, VAT Filing, Statutory Audit) — each spins up a parallel run for the Tax team (default head: Gautham). Audit reuses the CT Filing template.", act: { type: "urgent_config", btn: "Configure urgent compliance" } },
      { id: "t4b.3", title: "Senior confirms operational setup complete", kind: "person", who: ["Senior"], approval: { by: "Senior" }, note: "Senior reviews catch-up + urgent-compliance configuration before we proceed.", act: { type: "approve", role: "Senior", btn: "Confirm complete" } },
    ], gate: { label: "Senior confirmation", after: "t4b.3", sop: "Senior signs off the optional operations setup before we move to delivery." } },
    { id: "t6", name: "Project & Tasks — Internal Team", targetDays: 2, desc: "Separate from the client board: the recurring project and tasks created in the PMS for the internal team, then the live workflow diagrams.", steps: [
      { id: "t6.1", title: "Create internal projects & monthly tasks", kind: "person", who: ["AM"], note: "Internal delivery — choose the months, the tasks for each, set due dates and link templates / SOPs. Not shown to the client.", act: { type: "project", btn: "Create projects & tasks", reopen: true } },
      { id: "t6.2", title: "Build the workflow diagrams", kind: "person", who: ["AM", "Senior"], note: "Map the delivery / monthly-close process. Add as many diagrams as you need — they land in the client playbook → Workflows.", act: { type: "diagram", btn: "Confirm diagrams built", toast: "Workflow diagrams saved to playbook" } },
      { id: "t6.3", title: "Generate onboarding one-pager", kind: "person", who: ["AM"], note: "Polished one-pager summarising the compliance calendar, first delivery date, team contacts and UAE compliance details. Share with the client before recurring delivery kicks off.", act: { type: "onepager", btn: "Generate one-pager" } },
    ] },
    { id: "t7", name: "Handover", optional: true, desc: "Optional structured handover to the recurring medium team: pick destination → checklist → call → dual sign-off. Recommended, but the run can be completed without it.", steps: [
      { id: "t7.0", title: "Pick handover destination", kind: "person", who: ["AM"], note: "Choose the Team Lead / Senior who will RECEIVE this client for recurring delivery. They'll be added to the run team and notified.", act: { type: "assign", role: "Handover Lead", btn: "Set handover destination" } },
      { id: "t7.1", title: "Handover checklist", kind: "person", who: ["AM", "Senior"], note: "Confirm everything is in place before the handover call.", act: { type: "checklist", btn: "Checklist complete →", items: ["Access all shared via Zoho Vault", "Catch-up done (if any)", "Project & tasks created", "Drive shared"] } },
      { id: "t7.2", title: "Handover call to Medium Team", kind: "person", who: ["AM", "Senior"], note: "Hold the handover call. Add the recording link and the meeting notes once done.", act: { type: "call", memo: true, memoTitle: "Onboarding → Medium Team" } },
      { id: "t7.3", title: "Sign-off — Onboarding AM", kind: "person", who: ["AM"], note: "The onboarding AM signs off the handover. Can be sent back to any earlier handover step for rework.", act: { type: "approve", role: "Onboarding AM", btn: "Sign off — Onboarding AM", rework: true, reworkSteps: [{ id: "t7.1", title: "Handover checklist" }, { id: "t7.2", title: "Handover call to Medium Team" }] } },
      { id: "t7.4", title: "Confirm — Medium Team Lead", kind: "person", who: ["Senior"], note: "The receiving Medium-team Lead confirms the same handover. Only when both sign-offs are in does onboarding close.", act: { type: "approve", role: "Medium Team Lead", btn: "Confirm — Medium Team Lead", rework: true, reworkSteps: [{ id: "t7.1", title: "Handover checklist" }, { id: "t7.2", title: "Handover call to Medium Team" }, { id: "t7.3", title: "Sign-off — Onboarding AM" }] } },
      { id: "t7.5", title: "Mark onboarding complete", kind: "ai", who: ["System"], note: "Closes the run, moves the client to Completed, and goes live with the recurring team.", act: { type: "complete", btn: "Onboarding complete — move to Completed", toast: "Onboarding complete — recurring delivery is live" } },
    ], gate: { label: "Both sign-offs in", after: "t7.4" } },
  ],
  intake: [
    { id: "mt-i1", label: "PMS-synced company data", source: "pms", hint: "Name, owner, TRN, entity — pulled from PMS" },
    { id: "mt-i2", label: "AI business description", source: "ai", hint: "Generated from the email domain" },
    { id: "mt-i3", label: "Major revenue channels", source: "client" },
    { id: "mt-i4", label: "Major expense channels", source: "client" },
    { id: "mt-i5", label: "Employee details / attach employee documents", source: "client" },
    { id: "mt-i6", label: "Pain points", source: "client" },
    { id: "mt-i9", label: "Accounting software & historical months", source: "client", suggested: true },
    { id: "mt-i10", label: "Bank & payment gateways", source: "client", suggested: true },
    { id: "mt-i11", label: "VAT / CT status & fiscal year end", source: "client", suggested: true },
    { id: "mt-i12", label: "Preferred contact & reporting frequency", source: "client", suggested: true },
  ],
  uploads: [
    { id: "mt-u1", label: "Trade licence", who: "client" },
    { id: "mt-u2", label: "Tax certificates", who: "client" },
    { id: "mt-u3", label: "MOA", who: "client" },
    { id: "mt-u4", label: "Emirates ID — owners", who: "client" },
    { id: "mt-u5", label: "Passport — owners", who: "client" },
    { id: "mt-u6", label: "Trackers", who: "client" },
    { id: "mt-u7", label: "Bank statements — last 3–6 months", who: "client", suggested: true },
    { id: "mt-u8", label: "Previous financial statements", who: "client", suggested: true },
    { id: "mt-u9", label: "Existing ledger / COA export", who: "client", suggested: true },
  ],
  taskboard: [
    { id: "mt-t1", title: "Send magic link", owner: "AM", due: "Day 1", clientVisible: false, needsClient: false, chat: [] },
    { id: "mt-t2", title: "Client data received — checklist", owner: "Senior", due: "Day 4", clientVisible: true, needsClient: true, chat: [{ who: "Senior", text: "Hi — we're still missing your trade licence and last 3 months of bank statements.", t: "2 days ago" }] },
    { id: "mt-t3", title: "Prepare COA", owner: "Senior", due: "Day 6", clientVisible: false, needsClient: false, approval: "AM", chat: [] },
    { id: "mt-t4", title: "Meeting with client", owner: "AM", due: "Day 8", clientVisible: true, needsClient: true, chat: [] },
    { id: "mt-t6", title: "Create projects and tasks", owner: "AM", due: "Day 16", clientVisible: false, needsClient: false, chat: [] },
    { id: "mt-t7", title: "Handover", owner: "AM", due: "Day 18", clientVisible: true, needsClient: false, chat: [] },
  ],
};

const MICRO_TEAM: OnbTemplate = {
  id: "micro-team", name: "Client Onboarding — Micro", tier: "Micro",
  teamLabel: "Micro team (Lead + Team Lead + assigned senior)",
  desc: "Fast onboarding for smaller clients — same disciplined flow as Medium Team PLUS a branded, contract-scoped onboarding deck for the call and urgent-compliance routing.",
  color: "orange", live: true, usedBy: 0,
  event: "onboarding", flow: "client-onboarding",
  stages: [
    { id: "m1", name: "Assign Roles", targetDays: 1, desc: "AM assigns the Team Lead, Senior and Junior who will run this onboarding.", steps: [
      { id: "m1.1", title: "Run auto-created from template", kind: "ai", who: ["System"], pre: true, note: "Created the moment the client was marked signed — the Drive folder is auto-provisioned at the same time." },
      { id: "m1.1b", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Owns delivery quality for this client. AM can override the default.", act: { type: "assign", role: "Team Lead" } },
      { id: "m1.2", title: "Assign Senior Accountant", kind: "person", who: ["AM"], note: "Default: most-available senior. AM can override.", act: { type: "assign", role: "Senior" } },
      { id: "m1.3", title: "Assign Junior Accountant", kind: "person", who: ["AM"], note: "Optional — a junior isn't always needed. Skip and the stage still completes.", act: { type: "assign", role: "Junior", optional: true } },
    ] },
    { id: "m2", name: "Send Magic Link", targetDays: 2, desc: "Prepare the document upload list and the task board, create the Drive link — then dispatch (or re-send) the onboarding portal link.", steps: [
      { id: "m2.0a", title: "Upload contract & confirm deliverables", kind: "doc", who: ["AM", "Senior"], note: "Attach or paste the engagement contract — AI extracts scope, exclusions, payment terms and the reports we deliver (with timelines). Shown to the client in their portal.", act: { type: "contract", btn: "Upload & analyze contract" } },
      { id: "m2.2", title: "Set document upload list", kind: "doc", who: ["Senior"], note: "Mandatory. Standard UAE document set.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "m2.2b", title: "Configure all access & tools", kind: "person", who: ["Senior"], note: "The single step where we lock in every system the team will use for this client AND the access the client needs to grant. Tick each tool (accounting software, banks, payment gateways, FTA portal, payroll) and add the team emails the access should be shared with. Each gets a step-by-step SOP in the onboarding portal.", act: { type: "access", btn: "Configure all access & tools" } },
      { id: "m2.3", title: "Set the client task board", kind: "person", who: ["AM", "Senior"], note: "Mandatory. Toggle what's client-visible.", config: "taskboard", act: { type: "taskboard", btn: "Set client task board" } },
      { id: "m2.4", title: "Create & share client Drive link", kind: "link", who: ["System", "Senior"], note: "Generate the shareable Drive link.", act: { type: "drivelink", btn: "Create & share Drive link", toast: "Drive link created and shared with the client" } },
      { id: "m2.4b", title: "Send (or re-send) the onboarding portal link", kind: "link", who: ["AM"], note: "Generates the secure onboarding portal magic link plus ready-to-send email + WhatsApp templates. Use this step to dispatch the link for the first time AND to re-send if the client lost it. Add extra teammate emails who should also be able to open the portal — they're saved to the link and the templates are re-sent to all of them.", act: { type: "dispatch", btn: "Send / re-send portal link" } },
    ], gate: { label: "AM Approval", after: "m2.3", sop: "Review the document list and the client task board, then confirm." } },
    { id: "m4", name: "Call with Client", targetDays: 7, desc: "Contract-scoped branded deck opens the call, an optional AI agenda is sent ahead, then the meeting runs from a coverage checklist.", steps: [
      { id: "m4.0b", title: "Branded onboarding deck", kind: "ai", who: ["AI", "AM"], note: "Auto-generated client-facing deck, scoped from the contract + CRM + intake. Download or present.", act: { type: "deck", btn: "Generate onboarding deck" } },
      { id: "m4.0", title: "Generate & send call agenda (optional)", kind: "ai", who: ["AI", "AM"], note: "Optional — AI drafts a call agenda.", act: { type: "agenda", btn: "Generate & send agenda" } },
      { id: "m4.1", title: "Meeting — client discussion & scope alignment", kind: "person", who: ["AM", "Senior"], note: "Hold the client meeting. Cross off each coverage point, then add the recording link and your notes.", act: { type: "call", cover: ["Business model & revenue understood", "Payroll / salary points covered", "Accounting & compliance scope agreed", "Required documents walked through", "Open questions logged"] } },
      { id: "m4.1b", title: "Cross-sell checklist — what else does this client need?", kind: "person", who: ["AM"], note: "Tick every additional service the client is likely to need. Each ticked item is captured for follow-up — don't sell on the call.", act: { type: "checklist", btn: "Cross-sell captured", items: ["Statutory audit (revenue > AED 50M or required by free zone)", "Salary benchmarking — owner / executive comp review", "VAT registration (estimated taxable revenue > AED 375K)", "Corporate Tax registration (every UAE entity)", "Prior-period catch-up bookkeeping", "AML / UBO compliance (DNFBP — real estate / brokers / dealers)"] } },
      { id: "m4.2", title: "Welcome email — review & send", kind: "ai", who: ["AI", "AM"], note: "Builds the welcome email from the saved template: the client's name, company and portal link are filled in, plus the AI-drafted minutes of the meeting (from your call notes). Review, edit, then send — one step. Dispatch the portal magic link first.", act: { type: "mom", btn: "Generate welcome email" } },
      { id: "m4.3", title: "Confirm accounting software", kind: "person", who: ["AM", "Senior"], note: "Record which accounting software we'll run this client on (Zoho Books, QuickBooks, Xero, Odoo…). Saved to the client and shown in the playbook → Tools & Access.", act: { type: "accountingsoftware", btn: "Set accounting software" } },
    ] },
    { id: "m3", name: "COA Prep · Zoho Books", targetDays: 5, desc: "Senior prepares the COA and sets up Zoho Books. Penalty-risk compliance is triaged first. AM signs off.", steps: [
      { id: "m3.1", title: "Client data received — checklist", kind: "person", who: ["Senior"], note: "Cross off each item before COA prep. Attach the engagement contract to auto-detect catch-up backlog.", act: { type: "checklist", btn: "Confirm received", contract: true, items: ["Documents all collected", "Intake form completed (if used)", "Registrations confirmed (CT / VAT / WPS)", "Bank statements received"] } },
      { id: "m3.1b", title: "Urgent compliance triage", kind: "person", who: ["AM", "Senior"], note: "Flag penalty-risk items if any.", act: { type: "triage", btn: "Assign urgent items" } },
      { id: "m3.2", title: "Prepare COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited and sent to the AM.", act: { type: "coa", btn: "Build COA" } },
      { id: "m3.2b", title: "Confirm tax codes", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "UAE baseline + industry overlay + AI-suggested codes. Edit and export.", act: { type: "taxcodes", btn: "Build tax codes" } },
      { id: "m3.3", title: "Set up Zoho Books & import COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Connect Zoho Books, import the approved COA and confirm.", act: { type: "zoho", btn: "Import COA into Zoho" } },
      { id: "m3.4", title: "Create compliance calendar", kind: "ai", who: ["AI", "Senior"], note: "Auto-populated from filing due dates and document expiries.", act: { type: "calendar", btn: "Create compliance calendar", reopen: true } },
    ], gate: { label: "AM Approval", after: "m3.4", sop: "Review the COA numbering, Zoho import and compliance calendar, then approve." } },
    { id: "m4b", name: "Optional Operations", targetDays: 1, optional: true, desc: "Decide if catch-up bookkeeping or urgent compliance is needed. Catch-up + urgent compliance both route to Gautham (Tax Head). Senior confirms before we move on.", steps: [
      { id: "m4b.1", title: "Catch-up — configure & assign", kind: "person", who: ["AM"], note: "Decide yes/no. If yes, we spin up a parallel catch-up run assigned to Gautham (the only AM allowed to own catch-up). If no, this step is marked complete and we move on.", act: { type: "catchup_config", btn: "Configure catch-up" } },
      { id: "m4b.2", title: "Urgent compliance — configure & assign", kind: "person", who: ["AM"], note: "Is there any urgent compliance to handle? Pick yes/no. If yes, choose the services needed (CT Registration, VAT Registration, CT Filing, VAT Filing, Statutory Audit) — each spins up a parallel run for the Tax team (default head: Gautham). Audit reuses the CT Filing template.", act: { type: "urgent_config", btn: "Configure urgent compliance" } },
      { id: "m4b.3", title: "Senior confirms operational setup complete", kind: "person", who: ["Senior"], approval: { by: "Senior" }, note: "Senior reviews catch-up + urgent-compliance configuration before we proceed.", act: { type: "approve", role: "Senior", btn: "Confirm complete" } },
    ], gate: { label: "Senior confirmation", after: "m4b.3", sop: "Senior signs off the optional operations setup before we move to delivery." } },
    { id: "m6", name: "Project & Tasks — Internal Team", desc: "The recurring project and tasks created in the PMS for the internal team, then the live workflow diagrams.", steps: [
      { id: "m6.1", title: "Create internal projects & monthly tasks", kind: "person", who: ["AM"], note: "Internal delivery — not shown to the client.", act: { type: "project", btn: "Create projects & tasks", reopen: true } },
      { id: "m6.2", title: "Build the workflow diagrams", kind: "person", who: ["AM", "Senior"], note: "Map the delivery / monthly-close process.", act: { type: "diagram", btn: "Confirm diagrams built", toast: "Workflow diagrams saved to playbook" } },
      { id: "m6.3", title: "Generate onboarding one-pager", kind: "person", who: ["AM"], note: "Polished one-pager summarising the compliance calendar, first delivery date, team contacts and UAE compliance details. Share with the client before recurring delivery kicks off.", act: { type: "onepager", btn: "Generate one-pager" } },
    ] },
    { id: "m7", name: "Handover", optional: true, desc: "Optional structured handover: pick destination → checklist → call → dual sign-off. Recommended, but the run can be completed without it.", steps: [
      { id: "m7.0", title: "Pick handover destination", kind: "person", who: ["AM"], note: "Choose the Team Lead / Senior who will RECEIVE this client for recurring delivery. They'll be added to the run team and notified.", act: { type: "assign", role: "Handover Lead", btn: "Set handover destination" } },
      { id: "m7.1", title: "Handover checklist", kind: "person", who: ["AM", "Senior"], note: "Confirm everything is in place before the handover call.", act: { type: "checklist", btn: "Checklist complete →", items: ["Access all shared via Zoho Vault", "Catch-up done (if any)", "Project & tasks created", "Drive shared"] } },
      { id: "m7.2", title: "Handover call to recurring team", kind: "person", who: ["AM", "Senior"], note: "Hold the handover call.", act: { type: "call", memo: true, memoTitle: "Onboarding → Recurring Team" } },
      { id: "m7.3", title: "Sign-off — Onboarding AM", kind: "person", who: ["AM"], note: "The onboarding AM signs off.", act: { type: "approve", role: "Onboarding AM", btn: "Sign off — Onboarding AM", rework: true, reworkSteps: [{ id: "m7.1", title: "Handover checklist" }, { id: "m7.2", title: "Handover call to recurring team" }] } },
      { id: "m7.4", title: "Confirm — Recurring Team Lead", kind: "person", who: ["Senior"], note: "The receiving Team Lead confirms.", act: { type: "approve", role: "Recurring Team Lead", btn: "Confirm — Team Lead", rework: true, reworkSteps: [{ id: "m7.1", title: "Handover checklist" }, { id: "m7.2", title: "Handover call to recurring team" }, { id: "m7.3", title: "Sign-off — Onboarding AM" }] } },
      { id: "m7.5", title: "Mark onboarding complete", kind: "ai", who: ["System"], note: "Closes the run and goes live with the recurring team.", act: { type: "complete", btn: "Onboarding complete — move to Completed", toast: "Onboarding complete — recurring delivery is live" } },
    ], gate: { label: "Both sign-offs in", after: "m7.4" } },
  ],
  intake: [
    { id: "mc-i1", label: "PMS-synced company data", source: "pms", hint: "Name, owner, TRN, entity" },
    { id: "mc-i2", label: "AI business description", source: "ai", hint: "Generated from the email domain" },
    { id: "mc-i3", label: "Primary revenue & expense channels", source: "client" },
    { id: "mc-i4", label: "Preferred contact method", source: "client" },
    { id: "mc-i5", label: "Anything urgent we should know before the call", source: "client" },
  ],
  uploads: [
    { id: "mc-u1", label: "Trade licence", who: "client" },
    { id: "mc-u2", label: "MOA / AOA", who: "client" },
    { id: "mc-u3", label: "Passports / Emirates IDs — owners", who: "client" },
    { id: "mc-u4", label: "CT certificate", who: "client" },
    { id: "mc-u5", label: "VAT certificate (if applicable)", who: "client" },
    { id: "mc-u6", label: "Prior financial statements", who: "client" },
    { id: "mc-u7", label: "Bookkeeping records", who: "client" },
    { id: "mc-u8", label: "Contracts", who: "client" },
  ],
  taskboard: [
    { id: "mc-t1", title: "Kickoff deck presented", owner: "AM", due: "Day 0", clientVisible: true, needsClient: false, chat: [] },
    { id: "mc-t2", title: "Urgent compliance — CT / VAT deadlines", owner: "Senior", due: "Day 1", clientVisible: false, needsClient: false, chat: [] },
    { id: "mc-t3", title: "Share remaining documents", owner: "Client", due: "Day 2", clientVisible: true, needsClient: true, chat: [{ who: "Senior", text: "Welcome aboard! Please upload your trade licence and last 3 months of bank statements when you can.", t: "1 day ago" }] },
    { id: "mc-t4", title: "Books cleanup assessment", owner: "Senior", due: "Day 5", clientVisible: false, needsClient: false, chat: [] },
    { id: "mc-t5", title: "Sign off onboarding", owner: "Client", due: "Day 7", clientVisible: true, needsClient: true, chat: [] },
  ],
};

// Fast-track run created when an urgent compliance item is escalated to an AM.
// Deliberately minimal — the AM configures the real steps and assigns the owner.
const URGENT_COMPLIANCE: OnbTemplate = {
  id: "urgent-compliance",
  name: "Urgent Compliance",
  tier: "Escalation",
  teamLabel: "AM-led fast track",
  desc: "Fast-track run for an urgent compliance item escalated from onboarding. Configure the steps and assign the owner.",
  color: "red",
  live: true,
  usedBy: 0,
  stages: [
    { id: "uc1", name: "Triage & assign", desc: "Assign an owner and confirm the scope of the urgent item.", steps: [
      { id: "uc1.1", title: "Assign the owner for this item", kind: "person", who: ["AM"], note: "Pick who will action this urgent compliance item.", act: { type: "assign", role: "Senior", btn: "Assign owner" } },
      { id: "uc1.2", title: "Configure the resolution steps", kind: "person", who: ["AM"], note: "This run was auto-created from an escalation. Edit its tasks/template to fit the specific compliance item, then confirm.", act: { type: "checklist", btn: "Mark configured", items: ["Scope of the urgent item confirmed", "Owner assigned", "Deadline set"] } },
    ] },
    { id: "uc2", name: "Resolve", desc: "Work the item to closure.", steps: [
      { id: "uc2.1", title: "Resolve & confirm the compliance item", kind: "person", who: ["Senior"], act: { type: "checklist", btn: "Mark resolved", items: ["Action taken", "Evidence filed to Drive", "Client / authority confirmed"] } },
    ] },
  ],
  uploads: [],
  intake: [],
  taskboard: [],
};

// Created when a tracked document (Trade Licence / VAT / CT …) hits its expiry/filing date.
// Deliberately ONE pre-built task — no step configuration needed. Lands in the owner's My Work.
const COMPLIANCE_RENEWAL: OnbTemplate = {
  id: "compliance-renewal",
  name: "Compliance Renewal",
  tier: "Renewal",
  teamLabel: "AM / assigned owner",
  desc: "Auto-created when a tracked document (Trade Licence, VAT, Corporate Tax…) is due for renewal or filing. One simple task — no configuration.",
  color: "amber",
  live: true,
  usedBy: 0,
  stages: [
    { id: "rn1", name: "Renew & update", desc: "Renew the document, file the new copy, update the expiry.", steps: [
      { id: "rn1.1", title: "Renew & update the document", kind: "person", who: ["AM"], note: "This task was created automatically because a tracked document reached its due date. Renew it, upload the new copy to the client Drive folder, and update the expiry date.", act: { type: "checklist", btn: "Mark renewed", items: ["Renewal actioned with the authority / provider", "New document received", "Uploaded to the client Drive folder", "Expiry / next due date updated"] } },
    ] },
  ],
  uploads: [],
  intake: [],
  taskboard: [],
};

// Run created when catch-up accounting is handed to a DIFFERENT team — that team's AM
// configures the months and assigns owners.
const CATCHUP_RUN: OnbTemplate = {
  id: "catchup",
  name: "Catch-up Accounting",
  tier: "Catch-up",
  teamLabel: "Dedicated catch-up team (Aarju K + team)",
  desc: "Historical catch-up bookkeeping handled end-to-end: assign team, verify Drive docs + Zoho Vault access, request Zoho account, extract bank + first-pass recon, prep query sheet, build COA, close books, AI review, Team Lead 30-point QA, send final reports.",
  color: "teal",
  live: true,
  usedBy: 0,
  category: "Catch-up",
  event: "accounting", flow: "catchup-accounting",
  stages: [
    // 1. Role assignment ────────────────────────────────────────────────────
    { id: "cu1", name: "Assign Roles", desc: "Assign the Team Lead (default: Aarju K) and the team members under her who will work this catch-up.", steps: [
      { id: "cu1.1", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Default: Aarju K (Team Lead — ALC). The AM can override.", act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" } },
      { id: "cu1.2", title: "Assign team members", kind: "person", who: ["Team Lead"], note: "Pick the team members under the assigned Team Lead who will work this catch-up.", act: { type: "assign", role: "Senior", btn: "Assign team members" } },
    ] },

    // 2. Drive + document & access verification ─────────────────────────────
    { id: "cu2", name: "Drive & Verification", desc: "Send the client the kickoff document request, open the client Drive, cross-check every document and every Zoho Vault access, and draft a message for anything missing.", steps: [
      { id: "cu2.0", title: "Draft document request to client", kind: "ai", who: ["AI", "Team Lead"], note: "Draft the kickoff document-request message to the client — bookkeeping documents + FTA/EmaraTax portal access steps. Signed from the assigned Team Lead + teammate, with the client Drive link filled in. Edit before sending.", act: { type: "catchup_docrequest", btn: "Draft document request" } },
      { id: "cu2.1", title: "Open client Drive folder", kind: "link", who: ["Senior"], note: "The Drive folder is auto-created at client creation. Use this to access it.", act: { type: "drivelink", btn: "Open Drive folder" } },
      { id: "cu2.2", title: "Document checklist (Drive)", kind: "person", who: ["Senior"], note: "Tick each document present in the catch-up Drive folder. Items left unticked feed the missing-items draft message below. You can rename / add / remove items.", act: { type: "checklist", btn: "Documents verified", items: ["Trade Licence", "MOA / AOA", "Bank statements (catch-up period)", "Sales invoices", "Vendor bills", "Contracts (if any)", "Salary sheet (if any)", "Tracker (if any)"] } },
      { id: "cu2.3", title: "Access checklist (Zoho Vault)", kind: "person", who: ["Senior"], note: "Tick each access available in Zoho Vault. Items left unticked feed the missing-items draft message.", act: { type: "checklist", btn: "Access verified", items: ["FTA portal access", "Bank access", "Payment gateway access (if any)", "Other (specify)"] } },
      { id: "cu2.4", title: "Draft message — request the missing items", kind: "ai", who: ["AI", "Senior"], note: "Draft a copy-paste message to the client / internal team listing every unticked document + access. Edit before sending.", act: { type: "catchup_missing", btn: "Draft missing-items message" } },
    ] },

    // 3. Zoho account creation request to Lohith ────────────────────────────
    { id: "cu3", name: "Zoho Account Request", desc: "Draft the message to Lohith to create the client's Zoho account.", steps: [
      { id: "cu3.1", title: "Draft account-creation message to Lohith", kind: "ai", who: ["AI", "Senior"], note: "Draft: 'Hi Lohith, please create an account in Zoho for <company name>. Multi-currency: <yes/no>. Attached: TL and VAT certificate (if any).' Edit, copy, send to Lohith.", act: { type: "zoho_account", btn: "Draft message to Lohith" } },
    ] },

    // 4. Data review & query sheet prep ─────────────────────────────────────
    { id: "cu4", name: "Data Review & Query Sheet", desc: "Extract the bank statements, run a first-pass reconciliation, download Excel, capture queries into a Google Sheet, message the client.", steps: [
      { id: "cu4.1", title: "Bank extraction & first-pass reconciliation", kind: "person", who: ["Senior"], note: "Pulls bank statements from the client's Drive folder (prefers a 'Catch-up' or 'Bank Statements' sub-folder), extracts every line via Klippa, applies the categorisation rules against the live COA Google Sheet, and produces a 5-sheet XLSX (Summary / Raw / Categorised / Needs Review / COA Used). Output is ready for review — never auto-posted.", act: { type: "bankrecon", btn: "Run bank extraction & reconciliation" } },
      { id: "cu4.2", title: "Prepare query sheet (Google Sheets)", kind: "person", who: ["Senior"], note: "Open the query Google Sheet, capture every line item that needs the client's input, then paste the sheet link below for sending.", act: { type: "checklist", btn: "Query sheet ready", items: ["Reviewed the extracted Excel", "Captured every unknown line in the Google Sheet", "Sheet link captured for sending"] } },
      { id: "cu4.3", title: "Draft message — send query sheet to client", kind: "ai", who: ["AI", "Senior"], note: "Draft a message to the client with the query Google Sheet link asking them to resolve the open lines.", act: { type: "catchup_query", btn: "Draft query-sheet message" } },
    ] },

    // 5. Create COA + tax codes, upload docs to Zoho ────────────────────────
    { id: "cu5", name: "Create COA & Tax Codes", desc: "Build the Chart of Accounts and tax codes (same flow as standard onboarding), then upload every catch-up document to Zoho.", steps: [
      { id: "cu5.1", title: "Build COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited.", act: { type: "coa", btn: "Build COA" } },
      { id: "cu5.2", title: "Upload all documents to Zoho", kind: "person", who: ["Senior"], note: "Confirm every catch-up document has been uploaded to Zoho.", act: { type: "checklist", btn: "Uploaded to Zoho", items: ["Trade Licence uploaded", "MOA uploaded", "Bank statements uploaded", "Invoices uploaded", "Bills uploaded", "Tax certificates uploaded"] } },
    ] },

    // 6. Reconciliation progress ────────────────────────────────────────────
    { id: "cu6", name: "Reconciliation Progress", desc: "Map how much of the catch-up is done and capture any blockers.", steps: [
      { id: "cu6.1", title: "Track reconciliation progress", kind: "person", who: ["Senior"], note: "Tick each area as it completes and capture any blockers in the run chat.", act: { type: "checklist", btn: "Progress updated", items: ["Bank reconciliation complete", "Invoices reconciled", "Bills reconciled", "Salary / WPS reconciled", "No open blockers"] } },
    ] },

    // 7. Optional client follow-up ──────────────────────────────────────────
    { id: "cu7", name: "Client Follow-up (optional)", desc: "Send a follow-up query message if more data is needed from the client.", optional: true, steps: [
      { id: "cu7.1", title: "Send follow-up query to client", kind: "ai", who: ["AI", "Senior"], note: "Optional. Draft a follow-up to the client with the latest open queries. Paste the Google Sheet link to include it.", act: { type: "catchup_followup", btn: "Draft follow-up", optional: true } },
    ] },

    // 8. Close books — team review ──────────────────────────────────────────
    { id: "cu8", name: "Close Books", desc: "Team review — confirm the catch-up books are closed before AI / Team Lead review.", steps: [
      { id: "cu8.1", title: "Close books — team review", kind: "person", who: ["Senior"], note: "Team confirms every item is closed before the next review stages.", act: { type: "checklist", btn: "Books closed", items: ["P&L reviewed for anomalies", "Balance sheet ties out", "All schedules attached", "All queries with client resolved or disclosed", "Period locked"] } },
    ] },

    // 9. Claude AI review ──────────────────────────────────────────────────
    { id: "cu9", name: "AI Review (Claude)", desc: "Run an automated review across the 30 catch-up QA checkpoints — the result is saved here so the Team Lead has it for their final sign-off.", steps: [
      { id: "cu9.1", title: "Run AI review", kind: "ai", who: ["AI"], note: "Generates a structured review across all 30 catch-up QA checkpoints (material flux, cut-offs, schedules, VAT, CT, partner-statement match). Saved here for the Team Lead to read before their sign-off.", act: { type: "catchup_review", btn: "Run AI review" } },
    ] },

    // 10. Team Lead 30-point QA ─────────────────────────────────────────────
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

    // 11. Final send reports ────────────────────────────────────────────────
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

// ── ACCOUNTING department — Monthly Bookkeeping ──────────────────────────
// A general recurring-delivery flow. Teams copy this and tailor it per client.
const MONTHLY_ACCOUNTING: OnbTemplate = {
  id: "monthly-accounting",
  name: "Monthly Accounting",
  tier: "Monthly bookkeeping",
  teamLabel: "Accounting team (Senior + Junior, Manager review)",
  desc: "General monthly bookkeeping flow — data request → file → book → reconcile → close → review → report. Copy and tailor per client.",
  color: "teal",
  live: true,
  usedBy: 0,
  category: "Accounting",
  stages: [
    { id: "ma1", name: "Data Request", desc: "Draft and send the periodic data request to the client.", steps: [
      { id: "ma1.1", title: "Draft & send the data request", kind: "ai", who: ["AI", "Senior"], note: "AI drafts the request from a template — choose the cadence (monthly / quarterly / weekly), confirm the client name, edit any placeholders, then send. The data we ask for is listed in the message.", act: { type: "datareq", btn: "Draft data request" } },
    ] },
    { id: "ma2", name: "Confirm & File", desc: "Confirm everything is received and save it to the client's Drive.", steps: [
      { id: "ma2.1", title: "Confirm received & save to Drive", kind: "person", who: ["Senior"], note: "Confirm all requested data is in, then create/refresh the client's Drive folders for the period.", act: { type: "drivelink", btn: "Create & confirm Drive folders" } },
    ] },
    { id: "ma3", name: "Upload & Book", desc: "Book the bank, gateways and invoices/bills for the period.", steps: [
      { id: "ma3.1", title: "Set the document upload list", kind: "doc", who: ["Senior"], note: "Bank statements, payment-gateway settlement reports, invoices & bills.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "ma3.2", title: "Book bank transactions", kind: "person", who: ["Junior"], act: { type: "checklist", btn: "Bank booked", items: ["All bank statements imported", "Transactions coded", "Transfers matched"] } },
      { id: "ma3.3", title: "Book payment gateway settlements (if any)", kind: "person", who: ["Junior"], act: { type: "checklist", btn: "Gateways booked", optional: true, items: ["Settlement reports imported", "Fees booked", "Clearing reconciled"] } },
      { id: "ma3.4", title: "Book invoices & bills (if any)", kind: "person", who: ["Junior"], act: { type: "checklist", btn: "Invoices & bills booked", optional: true, items: ["Sales invoices recorded", "Vendor bills recorded", "AR/AP updated"] } },
    ] },
    { id: "ma4", name: "Bank Reconciliation", desc: "Reconcile every bank and gateway account.", steps: [
      { id: "ma4.1", title: "Bank reconciliation", kind: "person", who: ["Junior"], act: { type: "checklist", btn: "Reconciled", items: ["Closing balances match statements", "Unreconciled items explained", "Gateway clearing reconciled"] } },
    ] },
    { id: "ma5", name: "Month-End Entries", desc: "Post accruals, prepayments, depreciation and adjustments.", steps: [
      { id: "ma5.1", title: "Month-end entries", kind: "person", who: ["Senior"], act: { type: "checklist", btn: "Entries posted", items: ["Accruals & prepayments", "Depreciation", "Payroll / WPS", "Adjusting entries"] } },
    ] },
    { id: "ma6", name: "Review Books", desc: "Senior self-review before manager sign-off.", steps: [
      { id: "ma6.1", title: "Review the books", kind: "person", who: ["Senior"], act: { type: "checklist", btn: "Books reviewed", items: ["P&L reviewed for anomalies", "Balance sheet ties out", "Schedules attached"] } },
    ] },
    { id: "ma7", name: "Manager Review", desc: "Manager signs off the closed books.", steps: [
      { id: "ma7.1", title: "Review with manager", kind: "person", who: ["Senior"], approval: { by: "AM" }, act: { type: "approve", btn: "Manager sign-off", role: "Manager", rework: true } },
    ], gate: { label: "Manager sign-off" } },
    { id: "ma8", name: "Share Report", desc: "Send the monthly financial report to the client.", steps: [
      { id: "ma8.1", title: "Draft & share the monthly report", kind: "ai", who: ["AI", "AM"], note: "AI drafts the report email (P&L, balance sheet, cash flow highlights). Review, attach the reports, and send to the client.", act: { type: "report", btn: "Draft report email" } },
    ] },
  ],
  intake: [],
  uploads: [
    { id: "ma-u1", label: "Bank statements (all accounts)", who: "client" },
    { id: "ma-u2", label: "Payment gateway settlement reports", who: "client" },
    { id: "ma-u3", label: "Sales invoices", who: "client" },
    { id: "ma-u4", label: "Vendor bills & expenses", who: "client" },
  ],
  taskboard: [],
};

// ── TAXATION department — UAE compliance flows ────────────────────────────
// Five fixed-shape templates for the common urgent-compliance jobs the firm
// runs. Each is 3–4 steps, deliberately small, and follows the same shape:
//   1) Collect docs the team already has (paste the Drive link).
//   2) (Optional) ask the client for anything still missing via a no-login
//      upload link, with a copyable email + WhatsApp message + nudge button.
//   3) Do the filing inside the FTA portal.
//   4) Send the acknowledgement to the client.
//
// All five share category "Taxation" so they appear together in the Templates
// tab and the "+ New compliance run" picker, and stay OUT of the onboarding
// picker. The Assign step uses a special role token `Compliance AM` so the
// picker is scoped to AMs under Suhail and sorted by capacity (am_capacity).

const COMPLIANCE_DOCS_LIST_CT = [
  "Trade Licence (current)",
  "MOA / AOA",
  "Owner / shareholder Emirates ID",
  "Owner / shareholder passport copy",
  "Establishment / Immigration card",
  "Bank statement (last 3 months)",
];

const COMPLIANCE_DOCS_LIST_VAT = [
  "Trade Licence (current)",
  "MOA / AOA",
  "Bank statement (last 3 months)",
  "Sample sales invoices (last 12 months)",
  "Customs registration (if importer/exporter)",
  "Lease / tenancy contract",
];

const COMPLIANCE_DOCS_LIST_FTA = [
  "Trade Licence (latest)",
  "MOA / AOA (if amended)",
  "Owner / authorised signatory Emirates ID",
  "Latest FTA certificate (CT / VAT)",
];

function complianceTemplate(args: {
  id: string;
  name: string;
  desc: string;
  color: string;
  internalDocs: string[];
  /** Title of the "file / submit" step inside the FTA portal. */
  fileStepTitle: string;
  /** Items inside the file step's checklist. */
  fileSteps: string[];
  /** What we tell the client when we send the acknowledgement. */
  ackKind: "registration" | "filing" | "amendment";
  /** Whether to include the optional "request from client" step. Some flows
      need it (CT/VAT reg, amendment); CT/VAT filing is internal only by default. */
  includeClientRequest: boolean;
}): OnbTemplate {
  const idp = args.id;
  const stages: OnbTemplate["stages"] = [];

  // Stage 0 — assign tax team (three separate steps, same pattern as micro onboarding)
  stages.push({
    id: `${idp}0`, name: "Assign Team",
    desc: "Set the Account Manager, Team Lead, and Team Member before starting work.",
    steps: [
      {
        id: `${idp}0.1`,
        title: "Assign Account Manager",
        kind: "person",
        who: ["AM"],
        note: "Default: Gautam Sanoj (Tax Head). Change if needed.",
        act: { type: "assign", role: "AM", btn: "Assign AM" },
      },
      {
        id: `${idp}0.2`,
        title: "Assign Team Lead",
        kind: "person",
        who: ["AM"],
        note: "Default: Nafila. Change if needed.",
        act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" },
      },
      {
        id: `${idp}0.3`,
        title: "Assign Team Member",
        kind: "person",
        who: ["AM"],
        note: "Auto-suggested by capacity (least-loaded under Nafila). Change if needed.",
        act: { type: "assign", role: "Senior", btn: "Assign Team Member" },
      },
    ],
  });

  // Stage 1 — collect from team
  stages.push({
    id: `${idp}1`, name: "Collect documents from team",
    desc: "Confirm every document we already have internally + paste the Drive link the team shared.",
    steps: [
      {
        id: `${idp}1.1`,
        title: "Confirm internal documents received",
        kind: "person", who: ["AM", "Senior"],
        note: "Tick off each document as you confirm it on Drive. Paste the team's Drive link in this step's notes so anyone joining the run can find it.",
        act: { type: "checklist", btn: "All received from team", items: args.internalDocs },
      },
    ],
  });

  // Stage 2 — optional client request
  if (args.includeClientRequest) {
    stages.push({
      id: `${idp}2`, name: "Request missing documents from client",
      desc: "Send a no-login link the client can upload to. The team view shows status; nudge by WhatsApp or email if anything's slow.",
      steps: [
        {
          id: `${idp}2.1`,
          title: "Send no-login upload link + WhatsApp / email request",
          kind: "link", who: ["AM"],
          note: "Generates a no-login link the client can upload missing documents to, plus a ready-to-send email and WhatsApp message. The team view shows which documents are still pending — use Nudge to re-send.",
          act: { type: "dispatch", intake: true, btn: "Mark sent", optional: true },
        },
      ],
    });
  }

  // Stage 3 — file inside the FTA portal
  const fileStageId = args.includeClientRequest ? `${idp}3` : `${idp}2`;
  stages.push({
    id: fileStageId, name: args.fileStepTitle,
    desc: "Open the FTA portal and complete the submission with the documents collected.",
    steps: [
      {
        id: `${fileStageId}.1`,
        title: args.fileStepTitle,
        kind: "person", who: ["AM", "Senior"],
        note: "Open the FTA portal, sign in, and complete the submission. Tick each item as you go.",
        act: { type: "checklist", btn: "Submission complete", items: args.fileSteps },
      },
    ],
  });

  // Stage 4 — acknowledgement
  const ackStageId = args.includeClientRequest ? `${idp}4` : `${idp}3`;
  const ackTitle =
    args.ackKind === "registration" ? "Share registration acknowledgement with client"
    : args.ackKind === "filing"     ? "Share filing acknowledgement with client"
    :                                  "Share amendment acknowledgement with client";
  stages.push({
    id: ackStageId, name: "Send acknowledgement",
    desc: "Share the FTA acknowledgement / certificate with the client and close the run.",
    steps: [
      {
        id: `${ackStageId}.1`,
        title: ackTitle,
        kind: "person", who: ["AM"],
        note: "Attach the FTA acknowledgement / certificate, send it to the client, and tick to confirm.",
        act: {
          type: "checklist",
          btn: "Acknowledgement sent",
          items: [
            "FTA acknowledgement / certificate downloaded",
            "Uploaded to the client Drive folder",
            "Sent to the client (email / WhatsApp)",
            "Compliance record updated (next due date set)",
          ],
        },
      },
    ],
  });

  return {
    id: args.id,
    name: args.name,
    tier: "Compliance",
    teamLabel: "AM-led, Senior support",
    desc: args.desc,
    color: args.color,
    live: true,
    usedBy: 0,
    category: "Taxation",
    stages,
    uploads: [],
    intake: [],
    taskboard: [],
  };
}

const CT_REGISTRATION: OnbTemplate = complianceTemplate({
  id: "ct-registration",
  name: "Corporate Tax Registration",
  desc: "Register the client with the FTA for Corporate Tax. Collect documents → request anything missing from the client → file in the FTA portal → send acknowledgement.",
  color: "red",
  internalDocs: COMPLIANCE_DOCS_LIST_CT,
  fileStepTitle: "File CT registration in the FTA portal",
  fileSteps: ["Logged into the FTA portal", "Entity details entered", "Documents uploaded", "Registration submitted", "TRN / acknowledgement received"],
  ackKind: "registration",
  includeClientRequest: true,
});

const CT_FILING: OnbTemplate = complianceTemplate({
  id: "ct-filing",
  name: "Corporate Tax Filing",
  desc: "File the CT return inside the FTA portal — get the documents from the team (or client if anything's missing), enter the details, share the acknowledgement.",
  color: "red",
  internalDocs: ["Trial balance / management accounts for the period", "Final P&L and balance sheet", "Tax adjustments worksheet", "Supporting schedules (depreciation, related-party, etc.)"],
  fileStepTitle: "File CT return in the FTA portal",
  fileSteps: ["Logged into the FTA portal", "Period selected", "Figures entered (income, expenses, tax adjustments)", "Schedules uploaded", "Return submitted", "Acknowledgement downloaded"],
  ackKind: "filing",
  includeClientRequest: true,
});

const VAT_REGISTRATION: OnbTemplate = complianceTemplate({
  id: "vat-registration",
  name: "VAT Registration",
  desc: "Register the client with the FTA for VAT. Collect documents → request anything missing from the client → upload in the portal → send acknowledgement.",
  color: "amber",
  internalDocs: COMPLIANCE_DOCS_LIST_VAT,
  fileStepTitle: "Submit VAT registration in the FTA portal",
  fileSteps: ["Logged into the FTA portal", "Entity + activity details entered", "Turnover declaration entered", "Documents uploaded", "Registration submitted", "TRN / acknowledgement received"],
  ackKind: "registration",
  includeClientRequest: true,
});

const VAT_FILING: OnbTemplate = complianceTemplate({
  id: "vat-filing",
  name: "VAT Filing",
  desc: "File the VAT return inside the FTA portal — get the documents from the team (or client if missing), upload, submit, share the acknowledgement.",
  color: "amber",
  internalDocs: ["Sales register for the period", "Purchase / expense register for the period", "Imports + customs declarations", "Adjustments worksheet (corrections, RCM, zero-rated)"],
  fileStepTitle: "File VAT return in the FTA portal",
  fileSteps: ["Logged into the FTA portal", "Period selected", "Output VAT entered (standard + zero-rated + exempt + RCM)", "Input VAT entered", "Adjustments entered", "Return submitted", "Payment reference noted (if payable)", "Acknowledgement downloaded"],
  ackKind: "filing",
  includeClientRequest: true,
});

const FTA_AMENDMENT: OnbTemplate = complianceTemplate({
  id: "fta-amendment",
  name: "FTA Amendment",
  desc: "Amend an existing FTA registration (CT or VAT) — get the documents from the team, request anything more from the client if needed, upload in FTA, send acknowledgement.",
  color: "blue",
  internalDocs: COMPLIANCE_DOCS_LIST_FTA,
  fileStepTitle: "Submit amendment in the FTA portal",
  fileSteps: ["Logged into the FTA portal", "Existing registration opened", "Amended fields entered", "Updated documents uploaded", "Amendment submitted", "Acknowledgement downloaded"],
  ackKind: "amendment",
  includeClientRequest: true,
});

const AML_REVIEW: OnbTemplate = {
  id: "aml-review",
  name: "AML / UBO Review",
  tier: "Compliance",
  teamLabel: "Compliance team",
  desc: "Anti-Money Laundering review workflow — verify required documents are received, dispatch AML signing form to client, confirm return, mark completed.",
  color: "blue",
  live: true,
  usedBy: 0,
  category: "Compliance",
  stages: [
    {
      id: "aml1",
      name: "Document Verification",
      desc: "Confirm all four AML-required documents are present in Drive or portal.",
      assignRole: "am",
      steps: [
        { id: "aml1.1", title: "Confirm Trade Licence received", kind: "check", who: ["AM"] },
        { id: "aml1.2", title: "Confirm MOA / Articles of Association received", kind: "check", who: ["AM"] },
        { id: "aml1.3", title: "Confirm EID / Passport of owners received", kind: "check", who: ["AM"] },
        { id: "aml1.4", title: "Confirm Incorporation Certificate received", kind: "check", who: ["AM"] },
      ],
    },
    {
      id: "aml2",
      name: "AML Form Dispatch",
      desc: "Send the AML signing form link to the client and record the link.",
      assignRole: "am",
      steps: [
        { id: "aml2.1", title: "Generate AML signing form link", kind: "person", who: ["AM"], note: "Paste the signing link in the AML Compliance page for this client." },
        { id: "aml2.2", title: "Send AML signing link to client", kind: "person", who: ["AM"] },
        { id: "aml2.3", title: "Confirm client has received the form", kind: "check", who: ["AM"] },
      ],
    },
    {
      id: "aml3",
      name: "Signed Form Receipt",
      desc: "Confirm the signed AML form is returned and uploaded.",
      assignRole: "am",
      steps: [
        { id: "aml3.1", title: "Signed form received from client", kind: "check", who: ["AM"] },
        { id: "aml3.2", title: "Upload signed form to Drive", kind: "doc", who: ["AM"] },
        { id: "aml3.3", title: "Record completed signing link in AML page", kind: "person", who: ["AM"] },
      ],
    },
    {
      id: "aml4",
      name: "AML Sign-Off",
      desc: "Compliance team reviews and marks AML as completed.",
      assignRole: "am",
      steps: [
        { id: "aml4.1", title: "Compliance team reviews signed form", kind: "person", who: ["AM"] },
        { id: "aml4.2", title: "Mark AML status as Completed in AML Compliance page", kind: "person", who: ["AM"] },
        { id: "aml4.3", title: "Notify client — AML compliance completed", kind: "person", who: ["AM"] },
      ],
    },
  ],
  intake: [],
  uploads: [
    { id: "u1", label: "Trade Licence", who: "AM" },
    { id: "u2", label: "MOA / Articles of Association", who: "AM" },
    { id: "u3", label: "EID / Passport of owners", who: "AM" },
    { id: "u4", label: "Incorporation Certificate", who: "AM" },
    { id: "u5", label: "Signed AML form", who: "AM" },
  ],
  taskboard: [],
};

// ── Audit workflow (Liquidation & Audit section) ─────────────────────────────
// Stage-based workflow surfaced as a Kanban board (columns = stages) in the
// Liquidation & Audit section. Cases are created from the "Cadence Audit and
// Liquidation" Gmail automation (or manually). Default Team Lead: Aarju.
const AUDIT_WORKFLOW: OnbTemplate = {
  id: "audit-workflow",
  name: "Audit",
  tier: "Audit",
  teamLabel: "Audit team (Team Lead: Aarju + assigned member)",
  desc: "End-to-end statutory audit coordination: assign the team, request documents from the client, extract turnover + authority, request a quote from the auditor, AI-review the auditor's draft against the client's financials, deliver to the client and close with signed reports.",
  color: "blue",
  live: true,
  usedBy: 0,
  category: "Audit",
  event: "compliance",
  flow: "audit",
  stages: [
    { id: "au1", name: "Assign Roles", targetDays: 1, desc: "Assign the Team Lead (default: Aarju) and the team member who will run this audit.", steps: [
      { id: "au1.1", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Default: Aarju. Mark done to accept, or override with another Team Lead.", act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" } },
      { id: "au1.2", title: "Assign team member", kind: "person", who: ["Team Lead"], note: "Pick whoever under the Team Lead will handle this audit.", act: { type: "assign", role: "Senior", btn: "Assign team member" } },
    ] },
    { id: "au2", name: "Welcome & Documents", targetDays: 3, desc: "Optionally send a welcome message, then send the client the audit document request and confirm everything is received.", steps: [
      { id: "au2.1", title: "Send welcome message (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional short intro — introduces the assigned teammate and asks the client to confirm the contact channel (email / WhatsApp). Edit before sending.", act: { type: "audit_welcome", btn: "Draft welcome message", optional: true } },
      { id: "au2.2", title: "Send document request to client", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the full audit document request (VAT/CT certificates, FTA returns, bank statements, financials, WPS, loans, related parties, receivables/payables, fixed assets, tenancy, legal docs). Edit before sending.", act: { type: "audit_docrequest", btn: "Draft document request" } },
      { id: "au2.3", title: "Documents received — checklist", kind: "person", who: ["Senior"], note: "Confirm the client has shared everything before extraction.", act: { type: "checklist", btn: "Confirm received", items: ["VAT & CT certificates", "FTA VAT returns (audit periods)", "Bank statements (audit periods)", "Prior-year audit report (if any)", "Current-year financials (BS / P&L / TB)", "WPS / salary docs", "Loan documents (if any)", "Related-party licences & confirmations", "Receivables & payables list", "Fixed assets / PPE / lease / legal docs"] } },
    ] },
    { id: "au3", name: "Extract & Auditor Request", targetDays: 3, desc: "Extract the key figures from the client's documents, then request a quote and scope from the auditor.", steps: [
      { id: "au3.1", title: "Extract details from Drive", kind: "person", who: ["Senior"], note: "Open the client Drive and capture the values the auditor email needs — turnover (from the P&L or other financials), the trade-licence authority, and the audit purpose + year (from the contract). Record them in the notes.", act: { type: "checklist", btn: "Details captured", items: ["Drive reviewed", "Turnover captured from P&L / financials", "Trade-licence authority captured", "Audit purpose & year captured from contract"] } },
      { id: "au3.2", title: "Email auditor — quote & scope", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the request to the auditor with purpose, audit year, authority and turnover, and asks for the fee before starting. Paste the extracted values in the notes; edit before sending.", act: { type: "audit_auditor_email", btn: "Draft auditor email" } },
      { id: "au3.3", title: "Additional info requested by auditor (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional — if the auditor asks for more, paste their message + any notes and AI drafts a reply using the client document context. Edit before sending.", act: { type: "audit_client_reply", btn: "Draft reply", optional: true } },
    ] },
    { id: "au4", name: "Report Review", targetDays: 5, desc: "The auditor returns a draft report. AI cross-checks it against the client's P&L, balance sheet and financials, and flags mismatches to resolve.", steps: [
      { id: "au4.1", title: "AI review — draft report vs financials", kind: "ai", who: ["AI", "Team Lead"], note: "Paste the auditor's draft report figures / key numbers. AI cross-checks against the client's P&L, balance sheet and financial statements and returns a feedback list of matches and mismatches.", act: { type: "audit_report_review", btn: "Run AI review" } },
      { id: "au4.2", title: "Resolve review points with auditor", kind: "person", who: ["Team Lead"], note: "Work every flagged mismatch with the auditor until the report is clean.", act: { type: "checklist", btn: "All points resolved", items: ["Mismatches raised with auditor", "Corrections confirmed", "Final draft agreed"] } },
    ] },
    { id: "au5", name: "Delivery & Sign-off", targetDays: 5, desc: "Send the draft to the client, collect any feedback and payment, then close with the signed reports.", steps: [
      { id: "au5.1", title: "Send draft report to client", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts a message to the client sharing the draft audit report for review. Edit before sending.", act: { type: "audit_send_report", btn: "Draft client message" } },
      { id: "au5.2", title: "Client feedback / additional info (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional — if the client comes back with changes, paste their message + notes and AI drafts the reply. Edit before sending.", act: { type: "audit_client_reply", btn: "Draft reply", optional: true } },
      { id: "au5.3", title: "Payment collection (optional)", kind: "person", who: ["Team Lead"], note: "Optional — confirm the audit fee has been collected.", act: { type: "checklist", btn: "Payment confirmed", items: ["Invoice raised", "Payment received"], optional: true } },
      { id: "au5.4", title: "Signed report received from client", kind: "person", who: ["Senior"], note: "Confirm the client has signed and returned the report.", act: { type: "checklist", btn: "Client signed", items: ["Signed report received from client", "Uploaded to Drive"] } },
      { id: "au5.5", title: "Auditor signs & returns final report", kind: "person", who: ["Team Lead"], note: "The auditor signs and returns the final report to us.", act: { type: "checklist", btn: "Auditor signed", items: ["Final signed report received from auditor", "Uploaded to Drive"] } },
      { id: "au5.6", title: "Send final report to client & complete", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the closing message sharing the final signed audit report. Sending marks the case complete.", act: { type: "audit_send_report", btn: "Draft final message" } },
    ], gate: { label: "Both signatures in", after: "au5.5" } },
  ],
  intake: [],
  uploads: [
    { id: "au-u1", label: "VAT & CT certificates", who: "client" },
    { id: "au-u2", label: "FTA VAT returns", who: "client" },
    { id: "au-u3", label: "Bank statements (audit periods)", who: "client" },
    { id: "au-u4", label: "Prior-year audit report", who: "client" },
    { id: "au-u5", label: "Current-year financials (BS / P&L / TB)", who: "client" },
    { id: "au-u6", label: "WPS / salary documents", who: "client" },
    { id: "au-u7", label: "Loan documents", who: "client" },
    { id: "au-u8", label: "Related-party licences & confirmations", who: "client" },
    { id: "au-u9", label: "Legal documents (Licence / MOA / COI / EID / passports)", who: "client" },
  ],
  taskboard: [],
};

// ── Liquidation workflow (Liquidation & Audit section) ────────────────────────
// Mirrors the Audit workflow; only the client document request differs.
const LIQUIDATION_WORKFLOW: OnbTemplate = {
  id: "liquidation-workflow",
  name: "Liquidation",
  tier: "Liquidation",
  teamLabel: "Liquidation team (Team Lead: Aarju + assigned member)",
  desc: "End-to-end liquidation report coordination: assign the team, request documents from the client, extract the key figures, request a quote from the liquidator/auditor, AI-review the draft against the client's financials, deliver to the client and close with signed reports.",
  color: "amber",
  live: true,
  usedBy: 0,
  category: "Liquidation",
  event: "compliance",
  flow: "liquidation",
  stages: [
    { id: "li1", name: "Assign Roles", targetDays: 1, desc: "Assign the Team Lead (default: Aarju) and the team member who will run this liquidation.", steps: [
      { id: "li1.1", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Default: Aarju. Mark done to accept, or override with another Team Lead.", act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" } },
      { id: "li1.2", title: "Assign team member", kind: "person", who: ["Team Lead"], note: "Pick whoever under the Team Lead will handle this liquidation.", act: { type: "assign", role: "Senior", btn: "Assign team member" } },
    ] },
    { id: "li2", name: "Welcome & Documents", targetDays: 3, desc: "Optionally send a welcome message, then send the client the liquidation document request and confirm everything is received.", steps: [
      { id: "li2.1", title: "Send welcome message (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional short intro — introduces the assigned teammate and asks the client to confirm the contact channel (email / WhatsApp). Edit before sending.", act: { type: "audit_welcome", btn: "Draft welcome message", optional: true } },
      { id: "li2.2", title: "Send document request to client", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the full liquidation document request (trade licence, MOA, passports/EIDs, COI, board resolution, bank closure letter, prior audit, CT/VAT certificates + FTA summary, current-year financials). Edit before sending.", act: { type: "liq_docrequest", btn: "Draft document request" } },
      { id: "li2.3", title: "Documents received — checklist", kind: "person", who: ["Senior"], note: "Confirm the client has shared everything before extraction.", act: { type: "checklist", btn: "Confirm received", items: ["Trade licence", "MOA", "Passports & EIDs of shareholders", "Certificate of incorporation", "Board resolution (if any)", "Bank closure letter", "Prior-year audit (if any)", "CT & VAT certificates + FTA VAT summary", "Current-year financials"] } },
    ] },
    { id: "li3", name: "Extract & Report Request", targetDays: 3, desc: "Extract the key figures from the client's documents, then request a quote and scope from the liquidator/auditor.", steps: [
      { id: "li3.1", title: "Extract details from Drive", kind: "person", who: ["Senior"], note: "Open the client Drive and capture the values the request email needs — turnover (from financials), the trade-licence authority, and the purpose + year (from the contract). Record them in the notes.", act: { type: "checklist", btn: "Details captured", items: ["Drive reviewed", "Turnover captured from financials", "Trade-licence authority captured", "Purpose & year captured from contract"] } },
      { id: "li3.2", title: "Email liquidator/auditor — quote & scope", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the request with purpose, year, authority and turnover, and asks for the fee before starting. Paste the extracted values in the notes; edit before sending.", act: { type: "audit_auditor_email", btn: "Draft request email" } },
      { id: "li3.3", title: "Additional info requested (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional — if more info is requested, paste the message + notes and AI drafts a reply using the client document context. Edit before sending.", act: { type: "audit_client_reply", btn: "Draft reply", optional: true } },
    ] },
    { id: "li4", name: "Report Review", targetDays: 5, desc: "The liquidator/auditor returns a draft report. AI cross-checks it against the client's financials and flags mismatches to resolve.", steps: [
      { id: "li4.1", title: "AI review — draft report vs financials", kind: "ai", who: ["AI", "Team Lead"], note: "Paste the draft report figures / key numbers. AI cross-checks against the client's P&L, balance sheet and financial statements and returns a feedback list of matches and mismatches.", act: { type: "audit_report_review", btn: "Run AI review" } },
      { id: "li4.2", title: "Resolve review points", kind: "person", who: ["Team Lead"], note: "Work every flagged mismatch until the report is clean.", act: { type: "checklist", btn: "All points resolved", items: ["Mismatches raised", "Corrections confirmed", "Final draft agreed"] } },
    ] },
    { id: "li5", name: "Delivery & Sign-off", targetDays: 5, desc: "Send the draft to the client, collect any feedback and payment, then close with the signed reports.", steps: [
      { id: "li5.1", title: "Send draft report to client", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts a message to the client sharing the draft liquidation report for review. Edit before sending.", act: { type: "audit_send_report", btn: "Draft client message" } },
      { id: "li5.2", title: "Client feedback / additional info (optional)", kind: "ai", who: ["AI", "Team Lead"], note: "Optional — if the client comes back with changes, paste their message + notes and AI drafts the reply. Edit before sending.", act: { type: "audit_client_reply", btn: "Draft reply", optional: true } },
      { id: "li5.3", title: "Payment collection (optional)", kind: "person", who: ["Team Lead"], note: "Optional — confirm the fee has been collected.", act: { type: "checklist", btn: "Payment confirmed", items: ["Invoice raised", "Payment received"], optional: true } },
      { id: "li5.4", title: "Signed report received from client", kind: "person", who: ["Senior"], note: "Confirm the client has signed and returned the report.", act: { type: "checklist", btn: "Client signed", items: ["Signed report received from client", "Uploaded to Drive"] } },
      { id: "li5.5", title: "Liquidator/auditor signs & returns final report", kind: "person", who: ["Team Lead"], note: "The liquidator/auditor signs and returns the final report to us.", act: { type: "checklist", btn: "Report signed", items: ["Final signed report received", "Uploaded to Drive"] } },
      { id: "li5.6", title: "Send final report to client & complete", kind: "ai", who: ["AI", "Team Lead"], note: "Drafts the closing message sharing the final signed liquidation report. Sending marks the case complete.", act: { type: "audit_send_report", btn: "Draft final message" } },
    ], gate: { label: "Both signatures in", after: "li5.5" } },
  ],
  intake: [],
  uploads: [
    { id: "li-u1", label: "Trade licence", who: "client" },
    { id: "li-u2", label: "MOA", who: "client" },
    { id: "li-u3", label: "Passports & EIDs of shareholders", who: "client" },
    { id: "li-u4", label: "Certificate of incorporation", who: "client" },
    { id: "li-u5", label: "Board resolution", who: "client" },
    { id: "li-u6", label: "Bank closure letter", who: "client" },
    { id: "li-u7", label: "Prior-year audit report", who: "client" },
    { id: "li-u8", label: "CT & VAT certificates + FTA VAT summary", who: "client" },
    { id: "li-u9", label: "Current-year financials", who: "client" },
  ],
  taskboard: [],
};

// ── Tax team: one-time compliance document-collection flow ───────────────────
// Minimal 4-stage template for clients who only need documents collected for a
// one-time compliance submission. No COA, no Zoho, no welcome-email ceremony.
const COMPLIANCE_DOC_COLLECTION: OnbTemplate = {
  id: "compliance-doc-collection",
  name: "Compliance Doc Collection",
  tier: "Tax",
  teamLabel: "Tax team (AM + Senior)",
  desc: "Simplified flow for one-time compliance clients — collect required documents, review and submit. No onboarding ceremony.",
  color: "green",
  live: true,
  usedBy: 0,
  category: "Taxation",
  stages: [
    {
      id: "cdc1", name: "Assign & Scope", targetDays: 1,
      desc: "Tax AM assigned, scope confirmed, document checklist prepared.",
      steps: [
        { id: "cdc1.1", title: "Run created — assign Tax AM", kind: "person", who: ["Ops", "AM"], act: { type: "assign", role: "AM" } },
        { id: "cdc1.2", title: "Confirm compliance type & documents required", kind: "person", who: ["AM"], note: "Decide exactly which documents are needed for this submission (CT reg, VAT filing, etc.) and configure the upload list.", act: { type: "uploads", btn: "Set document list" } },
      ],
    },
    {
      id: "cdc2", name: "Document Request", targetDays: 5,
      desc: "Send a no-login upload link to the client with WhatsApp + email templates. Nudge until all documents are in.",
      steps: [
        { id: "cdc2.1", title: "Send no-login upload link to client", kind: "link", who: ["AM"], note: "Generates a public (no-login) upload link the client can use to submit documents. Copies ready-to-send WhatsApp and email messages.", act: { type: "dispatch", intake: true, btn: "Send upload link" } },
        { id: "cdc2.2", title: "Confirm all documents received", kind: "person", who: ["AM", "Senior"], note: "Tick off each document as it arrives. Use the Nudge button to re-send the upload link if items are still missing.", act: { type: "checklist", btn: "All documents received", items: ["Trade Licence (current)", "MOA / Articles of Association", "Owner Emirates ID & Passport", "Tax Certificates (CT / VAT TRN)", "Bank statements (last 3 months)", "Other client-specific documents"] } },
      ],
      gate: { label: "Documents complete", after: "cdc2.2", sop: "Confirm all required documents are received before proceeding to review." },
    },
    {
      id: "cdc3", name: "Review & Submit", targetDays: 3,
      desc: "Senior reviews documents for quality and compliance. AM submits via the FTA portal or relevant authority.",
      steps: [
        { id: "cdc3.1", title: "Senior reviews all documents", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Check completeness, validity dates (trade licence, EID), and any red flags. Flag any issues to AM before submitting." },
        { id: "cdc3.2", title: "Submit via FTA portal / authority", kind: "person", who: ["AM", "Senior"], note: "Log in to the relevant portal (FTA, CBUAE, MOHRE, etc.) and submit the application or filing. Paste the submission reference number in the step notes.", act: { type: "checklist", btn: "Submitted", items: ["Logged into portal", "Application / filing submitted", "Reference number noted", "Receipt / acknowledgement downloaded"] } },
      ],
      gate: { label: "AM Approval", after: "cdc3.1" },
    },
    {
      id: "cdc4", name: "Completion", targetDays: 1,
      desc: "Send acknowledgement to client. Close the run.",
      steps: [
        { id: "cdc4.1", title: "Send acknowledgement to client", kind: "person", who: ["AM"], note: "Share the submission confirmation / certificate with the client via email or WhatsApp. Confirm next steps (if any)." },
        { id: "cdc4.2", title: "Mark run complete", kind: "person", who: ["AM"] },
      ],
    },
  ],
  intake: [],
  uploads: [
    { id: "cdc-u1", label: "Trade Licence (current)", who: "client", suggested: true },
    { id: "cdc-u2", label: "MOA / Articles of Association", who: "client", suggested: true },
    { id: "cdc-u3", label: "Owner Emirates ID", who: "client", suggested: true },
    { id: "cdc-u4", label: "Owner Passport copy", who: "client" },
    { id: "cdc-u5", label: "Tax Certificate (CT / VAT TRN)", who: "client" },
    { id: "cdc-u6", label: "Bank statements (last 3 months)", who: "client" },
  ],
  taskboard: [
    { id: "cdc-t1", title: "Collect client documents", owner: "AM", due: "3 days", clientVisible: false, needsClient: true, chat: [] },
    { id: "cdc-t2", title: "Review documents", owner: "Senior", due: "5 days", clientVisible: false, needsClient: false, chat: [] },
    { id: "cdc-t3", title: "Submit to authority", owner: "AM", due: "7 days", clientVisible: false, needsClient: false, chat: [] },
    { id: "cdc-t4", title: "Send acknowledgement to client", owner: "AM", due: "8 days", clientVisible: true, needsClient: false, chat: [] },
  ],
};

export const ONB_TEMPLATES: OnbTemplate[] = [MEDIUM_ENTERPRISE, MEDIUM_TEAM, MICRO_TEAM, URGENT_COMPLIANCE, CATCHUP_RUN, COMPLIANCE_RENEWAL, MONTHLY_ACCOUNTING, CT_REGISTRATION, CT_FILING, VAT_REGISTRATION, VAT_FILING, FTA_AMENDMENT, AML_REVIEW, COMPLIANCE_DOC_COLLECTION, AUDIT_WORKFLOW, LIQUIDATION_WORKFLOW];
export const templateById = (id: string) => ONB_TEMPLATES.find((t) => t.id === id);

// The two Liquidation & Audit case templates, keyed by their `flow`. The
// Liquidation & Audit section creates and renders cases from these; they never
// appear in the onboarding / templates pickers (see ARCHIVED_TEMPLATE_IDS).
export const AUDIT_LIQUIDATION_TEMPLATE_IDS = ["audit-workflow", "liquidation-workflow"] as const;

// Templates hidden from the Templates gallery and the "new onboarding run" picker
// (platform cleanup, 2026-07) — only Client Onboarding · Micro and Catch-up
// Accounting remain browsable/pickable there. Nothing is deleted: these templates
// still resolve via getTemplate()/templateById() for existing runs and for the
// dedicated compliance-run / renewal / escalation flows that create runs from
// them directly (those aren't gated by this list).
export const ARCHIVED_TEMPLATE_IDS = new Set<string>([
  "medium-enterprise",
  "medium-team",
  "urgent-compliance",
  "compliance-renewal",
  "monthly-accounting",
  "ct-registration",
  "ct-filing",
  "vat-registration",
  "vat-filing",
  "fta-amendment",
  "aml-review",
  "compliance-doc-collection",
  // Audit & Liquidation templates ARE browsable in the Templates gallery (under
  // event "compliance"), but must never appear in the onboarding "new run"
  // picker — that exclusion is handled by category (Audit/Liquidation ≠
  // Onboarding) in onboarding-hub, so they are intentionally NOT archived here.
]);

export function stepCount(t: OnbTemplate) {
  return t.stages.reduce((n, s) => n + s.steps.length, 0);
}
