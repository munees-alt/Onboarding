// Faithful port of the prototype's onboarding templates engine (OB_TPL).
// Three editable flows. The run view + hub Templates tab render from this.

export type StepKind = "ai" | "person" | "link" | "doc" | "check";
export type WhoToken =
  | "System" | "AI" | "Client" | "Ops" | "AM" | "Senior" | "Junior";

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
      { id: "e5.3", title: "Post-call structured notes submitted", kind: "doc", who: ["AM"] },
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
    ] },
    { id: "e8", name: "Handover", desc: "Enforced, structured handover. Run does not close until every item is confirmed.", steps: [
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
    { id: "me-i8", label: "Reports needed", source: "client" },
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
    { id: "t1", name: "Assign Roles", desc: "AM assigns the Team Lead, Senior and Junior who will run this onboarding. Defaults pre-selected from the team roster.", steps: [
      { id: "t1.1", title: "Run auto-created from template", kind: "ai", who: ["System"], pre: true, note: "Created the moment the client was marked signed." },
      { id: "t1.1b", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Owns delivery quality for this client. AM can override the default.", act: { type: "assign", role: "Team Lead" } },
      { id: "t1.2", title: "Assign Senior Accountant", kind: "person", who: ["AM"], note: "Default: most-available senior. AM can override.", act: { type: "assign", role: "Senior" } },
      { id: "t1.3", title: "Assign Junior Accountant", kind: "person", who: ["AM"], note: "Default: most-available junior. AM can override.", act: { type: "assign", role: "Junior" } },
    ] },
    { id: "t2", name: "Send Magic Link", desc: "Prepare the intake form, the document upload list and the task board — then dispatch the client magic link.", steps: [
      { id: "t2.1", title: "Prepare intake form set (optional)", kind: "ai", who: ["AI", "Senior"], note: "OPTIONAL — decide yes/no. If yes, the PMS-synced + AI-drafted intake form is prepared and the Senior reviews before it goes out.", config: "intake", act: { type: "intake", btn: "Prepare intake form", optional: true } },
      { id: "t2.2", title: "Set document upload list", kind: "doc", who: ["Senior"], note: "Mandatory. Trade licence, tax certificates, MOA, owner EIDs/passports, trackers.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "t2.3", title: "Set the client task board", kind: "person", who: ["AM", "Senior"], note: "Mandatory. The board the client sees in their portal — toggle what's client-visible.", config: "taskboard", act: { type: "taskboard", btn: "Set client task board" } },
      { id: "t2.4", title: "Create & share client Drive link", kind: "link", who: ["System", "Senior"], note: "The Drive folder is auto-created when onboarding starts. Generate the shareable link — saved to the run and sent with the magic link.", act: { type: "drivelink", btn: "Create & share Drive link", toast: "Drive link created and shared with the client" } },
      { id: "t2.5", title: "Dispatch magic link to client", kind: "link", who: ["System"], note: "Sends the magic link (+ Drive link) to the client's email and Fincore chat. 7-day expiry.", act: { type: "dispatch", btn: "Dispatch magic link" } },
    ], gate: { label: "AM Approval", after: "t2.3", sop: "Review the intake form (if used), the document list and the client task board, then confirm before the magic link is dispatched." } },
    { id: "t3", name: "COA Prep · Zoho Books", desc: "Senior Accountant prepares the chart of accounts and sets up Zoho Books. AM signs off before it goes to the client.", steps: [
      { id: "t3.1", title: "Confirm all details received", kind: "person", who: ["Senior"], note: "Cross off each item before COA prep. Attach the engagement contract to auto-detect any catch-up backlog.", act: { type: "checklist", btn: "Confirm received", contract: true, items: ["Documents all collected", "Intake form completed", "Registrations confirmed (CT / VAT / WPS)", "Bank statements received"] } },
      { id: "t3.1b", title: "Urgent compliance triage", kind: "person", who: ["AM", "Senior"], note: "Flag penalty-risk items (CT / VAT / WPS / AML). For each, pick a person — it lands in their My Work with the task template ready.", act: { type: "triage", btn: "Assign urgent items" } },
      { id: "t3.2", title: "Prepare COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited and sent to the AM for review.", act: { type: "coa", btn: "Build COA" } },
      { id: "t3.3", title: "Set up Zoho Books & import COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Connect Zoho Books, import the approved COA and confirm.", act: { type: "zoho", btn: "Import COA into Zoho" } },
      { id: "t3.4", title: "Create compliance calendar", kind: "ai", who: ["AI", "Senior"], note: "Auto-populated from filing due dates (VAT, CT, WPS) and document expiries. Review, edit or add.", act: { type: "calendar", btn: "Create compliance calendar", reopen: true } },
    ], gate: { label: "AM Approval", after: "t3.4", sop: "Review the COA numbering, Zoho import and compliance calendar, then approve." } },
    { id: "t4", name: "Call with Client", desc: "Optional AI agenda sent ahead, then the client meeting covering COA review. AI generates the minutes of meeting from the recording.", steps: [
      { id: "t4.0", title: "Generate & send call agenda (optional)", kind: "ai", who: ["AI", "AM"], note: "Optional — AI drafts a call agenda from the intake + brief. Review and send before the call.", act: { type: "agenda", btn: "Generate & send agenda" } },
      { id: "t4.1", title: "Meeting — COA review & other discussions", kind: "person", who: ["AM", "Senior"], note: "Hold the client meeting. Cross off each coverage point, then add the recording link and your notes.", act: { type: "call", cover: ["Business model & revenue understood", "Payroll / salary points covered", "Accounting & compliance scope agreed", "COA reviewed with the client", "Required documents walked through", "Open questions logged"] } },
      { id: "t4.2", title: "AI generates Minutes of Meeting", kind: "ai", who: ["AI"], note: "MOM drafted from the recording. Review and confirm before it goes out.", act: { type: "ai", btn: "Generate MOM" } },
      { id: "t4.3", title: "Send MOM to client", kind: "link", who: ["System"], note: "Opens the full email — client name and company auto-inserted, signed off by Finanshels. Review and send.", act: { type: "mom", btn: "Open MOM email" } },
    ] },
    { id: "t5", name: "Catch-up Accounting", desc: "If the client has a backlog, catch-up runs here as a sub-tracked board before go-live. Senior review unlocks only once every catch-up task is done.", steps: [
      { id: "t5.1", title: "Configure & run catch-up tasks", kind: "person", who: ["Junior"], note: "Decide if catch-up is needed. If yes, a pop-up opens to set up the monthly catch-up board — editable any time.", act: { type: "catchup", btn: "Configure catch-up tasks", popup: true, reopen: true } },
      { id: "t5.2", title: "Senior review — confirm all catch-up completed", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "The Confirm button stays locked until every task on the catch-up board is Done.", act: { type: "approve", btn: "Confirm all completed", role: "Senior", gateOnCatchup: true } },
    ] },
    { id: "t6", name: "Project & Tasks — Internal Team", desc: "Separate from the client board: the recurring project and tasks created in the PMS for the internal team, then the live workflow diagrams.", steps: [
      { id: "t6.1", title: "Create internal projects & monthly tasks", kind: "person", who: ["AM"], note: "Internal delivery — choose the months, the tasks for each, set due dates and link templates / SOPs. Not shown to the client.", act: { type: "project", btn: "Create projects & tasks", reopen: true } },
      { id: "t6.2", title: "Build the workflow diagrams", kind: "person", who: ["AM", "Senior"], note: "Map the delivery / monthly-close process. Add as many diagrams as you need — they land in the client playbook → Workflows.", act: { type: "diagram", btn: "Confirm diagrams built", toast: "Workflow diagrams saved to playbook" } },
    ] },
    { id: "t7", name: "Handover", desc: "Structured handover to the recurring medium team: checklist, handover call, then dual sign-off. The run does not close until both the Onboarding AM and the Medium-team Lead confirm.", steps: [
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
    { id: "mt-i7", label: "Stakeholders", source: "client" },
    { id: "mt-i8", label: "Reports they need", source: "client" },
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
    { id: "mt-t2", title: "Confirm all details received", owner: "Senior", due: "Day 4", clientVisible: true, needsClient: true, chat: [{ who: "Senior", text: "Hi — we're still missing your trade licence and last 3 months of bank statements.", t: "2 days ago" }] },
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
  stages: [
    { id: "m1", name: "Assign Roles", desc: "AM assigns the Team Lead, Senior and Junior who will run this onboarding.", steps: [
      { id: "m1.1", title: "Run auto-created from template", kind: "ai", who: ["System"], pre: true, note: "Created the moment the client was marked signed — the Drive folder is auto-provisioned at the same time." },
      { id: "m1.1b", title: "Assign Team Lead", kind: "person", who: ["AM"], note: "Owns delivery quality for this client. AM can override the default.", act: { type: "assign", role: "Team Lead" } },
      { id: "m1.2", title: "Assign Senior Accountant", kind: "person", who: ["AM"], note: "Default: most-available senior. AM can override.", act: { type: "assign", role: "Senior" } },
      { id: "m1.3", title: "Assign Junior Accountant", kind: "person", who: ["AM"], note: "Default: most-available junior. AM can override.", act: { type: "assign", role: "Junior" } },
    ] },
    { id: "m2", name: "Send Magic Link", desc: "Prepare the (optional) intake form, the document upload list and the task board, create the Drive link — then dispatch the magic link.", steps: [
      { id: "m2.1", title: "Prepare intake form set (optional)", kind: "ai", who: ["AI", "Senior"], note: "OPTIONAL — decide yes/no.", config: "intake", act: { type: "intake", btn: "Prepare intake form", optional: true } },
      { id: "m2.2", title: "Set document upload list", kind: "doc", who: ["Senior"], note: "Mandatory. Standard UAE document set.", config: "uploads", act: { type: "uploads", btn: "Set document list" } },
      { id: "m2.3", title: "Set the client task board", kind: "person", who: ["AM", "Senior"], note: "Mandatory. Toggle what's client-visible.", config: "taskboard", act: { type: "taskboard", btn: "Set client task board" } },
      { id: "m2.4", title: "Create & share client Drive link", kind: "link", who: ["System", "Senior"], note: "Generate the shareable Drive link.", act: { type: "drivelink", btn: "Create & share Drive link", toast: "Drive link created and shared with the client" } },
      { id: "m2.5", title: "Dispatch magic link to client", kind: "link", who: ["System"], note: "Sends the magic link (+ Drive link). 7-day expiry.", act: { type: "dispatch", btn: "Dispatch magic link" } },
    ], gate: { label: "AM Approval", after: "m2.3", sop: "Review the intake form (if used), the document list and the client task board, then confirm." } },
    { id: "m3", name: "COA Prep · Zoho Books", desc: "Senior prepares the COA and sets up Zoho Books. Penalty-risk compliance is triaged first. AM signs off.", steps: [
      { id: "m3.1", title: "Confirm all details received", kind: "person", who: ["Senior"], note: "Cross off each item before COA prep. Attach the engagement contract to auto-detect catch-up backlog.", act: { type: "checklist", btn: "Confirm received", contract: true, items: ["Documents all collected", "Intake form completed (if used)", "Registrations confirmed (CT / VAT / WPS)", "Bank statements received"] } },
      { id: "m3.1b", title: "Urgent compliance triage", kind: "person", who: ["AM", "Senior"], note: "Flag penalty-risk items if any.", act: { type: "triage", btn: "Assign urgent items" } },
      { id: "m3.2", title: "Prepare COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Auto-populated from the industry, then edited and sent to the AM.", act: { type: "coa", btn: "Build COA" } },
      { id: "m3.3", title: "Set up Zoho Books & import COA", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Connect Zoho Books, import the approved COA and confirm.", act: { type: "zoho", btn: "Import COA into Zoho" } },
      { id: "m3.4", title: "Create compliance calendar", kind: "ai", who: ["AI", "Senior"], note: "Auto-populated from filing due dates and document expiries.", act: { type: "calendar", btn: "Create compliance calendar", reopen: true } },
    ], gate: { label: "AM Approval", after: "m3.4", sop: "Review the COA numbering, Zoho import and compliance calendar, then approve." } },
    { id: "m4", name: "Call with Client", desc: "Contract-scoped branded deck opens the call, an optional AI agenda is sent ahead, then the meeting runs from a coverage checklist.", steps: [
      { id: "m4.0a", title: "Attach contract & confirm deck scope", kind: "person", who: ["AM", "Senior"], note: "Attach the engagement contract — the branded deck's scope is built from it.", act: { type: "checklist", btn: "Confirm scope from contract", contract: true, items: ["Engagement contract attached", "Services in scope confirmed", "Fees & timeline confirmed"] } },
      { id: "m4.0b", title: "Branded onboarding deck", kind: "ai", who: ["AI", "AM"], note: "Auto-generated client-facing deck, scoped from the contract + CRM + intake. Advisory only.", act: { type: "deck", btn: "Generate onboarding deck" } },
      { id: "m4.0", title: "Generate & send call agenda (optional)", kind: "ai", who: ["AI", "AM"], note: "Optional — AI drafts a call agenda.", act: { type: "agenda", btn: "Generate & send agenda" } },
      { id: "m4.1", title: "Meeting — COA review & other discussions", kind: "person", who: ["AM", "Senior"], note: "Hold the client meeting.", act: { type: "call", cover: ["Business model & revenue understood", "Payroll / salary points covered", "Accounting & compliance scope agreed", "COA reviewed with the client", "Required documents walked through", "Open questions logged"] } },
      { id: "m4.2", title: "AI generates Minutes of Meeting", kind: "ai", who: ["AI"], note: "MOM drafted from the recording.", act: { type: "ai", btn: "Generate MOM" } },
      { id: "m4.3", title: "Send MOM to client", kind: "link", who: ["System"], note: "Opens the full email.", act: { type: "mom", btn: "Open MOM email" } },
    ] },
    { id: "m5", name: "Catch-up Accounting", desc: "If the client has a backlog, catch-up runs here before go-live.", steps: [
      { id: "m5.1", title: "Configure & run catch-up tasks", kind: "person", who: ["Junior"], note: "Decide if catch-up is needed.", act: { type: "catchup", btn: "Configure catch-up tasks", popup: true, reopen: true } },
      { id: "m5.2", title: "Senior review — confirm all catch-up completed", kind: "person", who: ["Senior"], approval: { by: "AM" }, note: "Locked until every task on the catch-up board is Done.", act: { type: "approve", btn: "Confirm all completed", role: "Senior", gateOnCatchup: true } },
    ] },
    { id: "m6", name: "Project & Tasks — Internal Team", desc: "The recurring project and tasks created in the PMS for the internal team, then the live workflow diagrams.", steps: [
      { id: "m6.1", title: "Create internal projects & monthly tasks", kind: "person", who: ["AM"], note: "Internal delivery — not shown to the client.", act: { type: "project", btn: "Create projects & tasks", reopen: true } },
      { id: "m6.2", title: "Build the workflow diagrams", kind: "person", who: ["AM", "Senior"], note: "Map the delivery / monthly-close process.", act: { type: "diagram", btn: "Confirm diagrams built", toast: "Workflow diagrams saved to playbook" } },
    ] },
    { id: "m7", name: "Handover", desc: "Structured handover to the recurring team: checklist, handover call, then dual sign-off.", steps: [
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
    { id: "mc-i4", label: "Key stakeholders & preferred contact", source: "client" },
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

export const ONB_TEMPLATES: OnbTemplate[] = [MEDIUM_ENTERPRISE, MEDIUM_TEAM, MICRO_TEAM];
export const templateById = (id: string) => ONB_TEMPLATES.find((t) => t.id === id);

export function stepCount(t: OnbTemplate) {
  return t.stages.reduce((n, s) => n + s.steps.length, 0);
}
