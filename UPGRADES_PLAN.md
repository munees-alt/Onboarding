# Cadence — Upgrades Plan (2026-06-22)

**Purpose:** a durable, hand-off-ready plan for 7 upgrades requested by Munees. Any agent can
pick this up and continue. Read this top-to-bottom, then execute items in the suggested order.
Update the checkboxes + "STATUS" lines as you go.

---

## How this app works (orientation — read first)

- **App lives in `cadence/`.** Stack: Next.js 16 (App Router, Turbopack), React 19, TS, Tailwind v4,
  Supabase (Postgres + Auth + Storage). Run dev from `cadence/`. **Next.js 16 is NOT standard** — read
  `node_modules/next/dist/docs/` before writing route/proxy code (see `cadence/AGENTS.md`).
- **`"use server"` GOTCHA (has bitten this repo repeatedly, incl. this session):** a `"use server"`
  actions file may ONLY export `async function`s. Exporting a `const`/object/array → runtime E352
  "can only export async functions" → the WHOLE actions module fails. Keep constants in the client
  view file or a non-server lib. Types/interfaces are fine (erased). After editing any `actions.ts`,
  `grep -n "^export (const|let|var|class|default)"` to catch it.
- **Templates: code vs DB.** Built-in templates are in `src/lib/onboarding-templates.ts`, but runs
  render from the **DB** `onboarding_templates.data` (jsonb, keyed by template id). `getTemplate()`
  reads DB; code is only the fallback when a row is missing. **Editing the code template does NOT
  change existing runs — you must also patch the DB rows** (walk `data.stages[].steps[]`). Pattern
  used this session: a one-off pg script via the session pooler (below).
- **DB migrations / scripts on this machine:** the direct DB host `db.<ref>.supabase.co:5432` is
  FIREWALLED here. Use the **session pooler**: take `DATABASE_URL`, replace `:6543/`→`:5432/`,
  connect with `pg` + `ssl:{rejectUnauthorized:false}`. Migrations live in `supabase/migrations/`
  (next free number is **0027** — note there are duplicate 0025s: `0025_portal_otp_backup.sql` and
  `0025_client_meetings.sql`; latest are 0026_pulse). Example runner used all session:
  ```js
  import pg from "pg"; import { readFile } from "node:fs/promises";
  let conn=(process.env.DATABASE_URL||"").replace(":6543/",":5432/").replace(/[?&]pgbouncer=true/i,"");
  const c=new pg.Client({connectionString:conn,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:20000});
  await c.connect(); await c.query(await readFile("supabase/migrations/0027_x.sql","utf8")); await c.end();
  ```
  Run with `node --env-file=.env.local scripts/<name>.mjs`. Delete one-off scripts after running.
- **AI layer:** `src/lib/ai.ts` → `runAi(orgId, feature, { system, prompt })` returns a string.
  Features (with token caps) in `FEATURE_TUNING`: brief/coa/agenda/mom/welcome_email/handover_summary.
  Reuse `handover_summary` (3000 cap) for big generations or `brief`/`coa` for smaller. AI is
  Claude-first with OpenAI fallback; **OpenAI is the live engine** (Anthropic key field holds an
  OpenAI key; Google quota out). NEVER invent data — if missing, say so (house rule).
- **COA builder (the model to copy for Tax Codes — item 1):** `CoaBuilderModal` in
  `src/app/(app)/onboarding/[runId]/run-view.tsx`; `generateCoa`/`saveCoa` in `ai-actions.ts`;
  stored in `coa_instances`; org-level master in `/master-coa` (`coa_master` table, `lib/master-coa.ts`).
  Step wiring: a template step with `act: { type: "coa", btn: "Build COA" }` opens the modal.
- **Compliance calendar (item 2 builds on this):** `generateComplianceFromDocs(runId)` in `ai-actions.ts`
  reads the client Drive folder (`drive_folders.tree.id`) + portal-uploaded `documents`, extracts
  expiry/incorp/VAT/CT dates via OpenAI files API, stores `run_items` kind `compliance`. Built from
  `ItemsBuilderModal` (kind=compliance). **A cron already exists:** `/api/cron/task-sla` (vercel.json
  cron `0 6 * * *`, protected by `CRON_SECRET`) already scans `run_items` kind `compliance` and
  notifies the AM when due within 14 days (deduped via `data.notified`). Item 2 = make this a real
  alert system (configurable lead times, in-app + email, client + team).
- **SLA (item 3) — partial exists:** task-level SLA is built — `saveTaskSla` (run_items `task_sla`),
  the same cron notifies AM for not-started/overdue tasks. Item 3 = ONBOARDING-level SLA (per
  stage/step time targets + breach tracking + dashboard + alerts).
- **Notifications:** `notifications` table (kind: escalation|milestone|info|task_tag). Action Centre
  bell reads it. Email send: `sendGmailAs(teamMemberId, to, subject, body)` via a Google-connected
  member; find one with `getDriveCapableMemberId(orgId)` (Munees is connected w/ gmail.send).
- **Clients:** `clients` table (`primary_contact_email`, `industry`, `entity_type`, `vat_registered`,
  `vat_trn`, `ct_registered`, `bank_names[]`, `payment_gateways[]`, `accounting_software`,
  `revenue_bracket`, `facts jsonb`, `business_description`, `pain_points[]`, `call_insights jsonb`,
  `call_notes`, `call_summary`). Client playbook UI: `src/app/(app)/clients/[id]/client-playbook-view.tsx`
  (Company Overview tab = `ClientData`), data assembled in `clients/[id]/page.tsx`, actions in
  `clients/actions.ts`.
- **Roles:** `src/lib/roles.ts` — `isMasterAdmin` (admin), `canManageCoa` (admin/ops_head/am).
  Step gating (this session): only `act.type === "approve"` steps are AM-only; everything else open
  to all team roles. Flag `ENFORCE_STEP_ROLES` in `actions.ts` + `run-view.tsx`.
- **Pulse / management digest (built this session):** `/pulse` module (`src/app/(app)/pulse/`) is the
  pattern to copy for the **client weekly digest (item 5)** — entry table + `runAi` digest +
  `sendGmailAs`. The Pulse "feature/feedback/todo" knowledge is the management-facing version.
- **Client meetings (item 6 input):** `client_meetings` table + `addClientMeeting`; Fathom sync via
  `src/lib/fathom.ts` (needs a connected Fathom key). Call insights live on `clients.call_insights`.
- **Verify in preview:** `.claude/launch.json` server "cadence" (port 3000). Login is a server-action
  form — fill via native setter + `form.requestSubmit()` (plain `.click()` won't submit). Admin:
  `munees@finanshels.com` / `Cadence2026!`. Tables navigate by clicking the `<tr>` (dispatch a
  bubbling MouseEvent), not anchors. `preview_screenshot` flaky — use `preview_eval`/innerText.
- **Deploy:** `npx vercel --prod --yes --archive=tgz` (plain upload hits a TLS error on this network).
  **A FULL SESSION OF WORK (batches 9a–9i) IS UNDEPLOYED** — deploy before/with these upgrades. Also
  set new env vars (e.g. Zoho creds already in `.env.local`) in Vercel.

---

## Item 1 — Industry-tailored TAX CODES (post-call, like COA)  ☐

**Goal:** after the discovery call, generate a set of UAE VAT/tax codes tailored to the client's
industry + what was discussed (e.g. RCM needed, zero-rated, exempt, out-of-scope, designated zone).
Team reviews/edits, then saves per client — exactly like the COA flow.

**Tax codes to support (UAE):** Standard Rated 5%, Zero Rated 0% (exports, certain supplies),
Exempt (financial services, residential property, local passenger transport), Out of Scope,
Reverse Charge Mechanism (RCM — imports/services from abroad), Designated Zone, Deemed Supply.
Each code: `{ code, label, rate, type, appliesTo (notes), reverseCharge: bool, enabled: bool }`.

**Build:**
- Migration `0027_tax_codes.sql`: `tax_code_sets (id, org_id, client_id, run_id, codes jsonb, ai_rationale, base_industry, created_at)` + org RLS. (Mirror `coa_instances`.) Optionally a `tax_code_master` per industry later (mirror `coa_master`) — defer unless asked.
- `ai-actions.ts`: `generateTaxCodes(runId)` — pulls client industry + `call_insights`/`business_description` + intake (revenue channels, exports, imports) → `runAi(orgId, "coa", {...})` (reuse coa tuning, low temp) → returns `{ codes[], rationale, industry }`. Prompt: classify by the client's actual activity; turn ON RCM if imports/foreign services discussed; Zero-rated if exports; Exempt per sector; explain each in `appliesTo`. NO invented data.
- `saveTaxCodes(runId, stepId, codes, rationale, industry)` → upsert `tax_code_sets`; notify AM.
- UI: `TaxCodeBuilderModal` in `run-view.tsx` — copy `CoaBuilderModal` structure (intro → generate → review with per-row enable/edit + add/delete, grouped by type, Export to Excel reusing `exportCoaCsv` pattern). Open via a new step `act: { type: "taxcodes", btn: "Build tax codes" }`.
- Template step: add "Prepare tax codes" right after the COA step in medium-team (t3) + micro (m3)
  (and monthly-accounting if relevant). who: ["Senior"]. **Patch both code template AND DB rows**
  (templates code+DB gotcha above). Wire `act.type==='taxcodes'` → TaxCodeBuilderModal in run-view's
  `openAct` switch (search where `coa` act opens CoaBuilderModal).
- Show on client playbook (a "Tax codes" panel in Company Overview or a tab) + optionally portal.

**Acceptance:** on a run, "Build tax codes" → AI returns industry-appropriate codes incl. RCM/zero-rated
when the call/intake implies them; team edits + saves; appears on the client playbook; Export to Excel.

**Open Q:** also want an org-level Master Tax Codes editor (like Master COA)? Assume no for v1.

---

## Item 2 — Compliance calendar ALERT SYSTEM  ☐

**Goal:** turn the compliance calendar into real alerts: notify ahead of due/expiry dates (in-app +
email), to the team (AM/assigned) and optionally the client, with configurable lead times; auto-create
a task/Run when something is due (user asked earlier for "expiry → auto task/Run").

**Build (extends the existing cron):**
- Lead-time config per run (or org): `run_items` kind `compliance_alert_cfg` `{ leadDays:[30,14,7,1], notifyClient:bool, autoCreateTask:bool }` (default `[30,7,1]`). Small modal on the compliance board ("Alert settings").
- Extend `/api/cron/task-sla/route.ts` (or new `/api/cron/compliance`): for each `run_items` kind
  `compliance`, compare each item's date to today; for each crossed lead-time fire a `notifications`
  row (kind `escalation`) to the AM (+ client email if `notifyClient`), deduped per `(item, leadDay)`
  via `data.notified[]`. If `autoCreateTask`, create a task on the run's board (or a `URGENT_COMPLIANCE`
  run via the existing `escalateUrgentCompliance` pattern) once at the first lead-time.
- Surface upcoming alerts on the client playbook Compliance tab + an org-wide "Upcoming compliance"
  view (optional) for Master Admin.
- vercel.json cron already daily `0 6 * * *`; keep `CRON_SECRET`.

**Acceptance:** a compliance item due in ≤30/≤7/≤1 days produces a deduped AM notification (and client
email if enabled); optionally spawns a task/Run; visible on the playbook.

---

## Item 3 — SLA for ONBOARDING tracking + updates  ☐

**Goal:** track onboarding against time SLAs (overall + per stage), show status (on-track / at-risk /
breached), and alert when at-risk/breached. (Task-level SLA already exists; this is run/stage level.)

**Build:**
- SLA targets: per template, a `slaDays` per stage (add to template `data` or an org config
  `run_items`/new table `onboarding_sla (org_id, template_key, stage_no, target_days)`). Default a
  sensible map (e.g. Assign 1d, Magic link 2d, COA 5d, Kickoff 7d, …). Keep editable by Master Admin.
- Compute status from `onboarding_runs.started_at` + stage entered timestamps. Stage-entered times
  aren't stored today — add `run_stages.entered_at` (or compute from `run_steps.completed_at`). Simplest:
  store `stage_started_at` on stage transition in `recompute()` (actions.ts).
- Cron (reuse `/api/cron/task-sla`): for active runs, if `today - stage_started_at > target` → at-risk/
  breached → notify AM + ops_head, deduped.
- UI: a SLA chip/column on the Onboarding hub table + run header ("On track / 2d over on COA"); a
  Master-Admin SLA dashboard (optional). Also feed breaches into the Pulse digest (item links).

**Acceptance:** runs show SLA status; a breached stage notifies AM/ops; configurable targets.

**Open Q:** confirm SLA targets per stage (get the real numbers from Munees / the management meeting).

---

## Item 4 — CROSS-SELL checklist on the onboarding call  ☐

**Goal:** during the onboarding/discovery call, a checklist of additional services to assess + flag as
opportunities per client: **Audit, Salary benchmarking, VAT registration (on estimated revenue),
Corporate Tax registration need, Catch-up accounting, Compliance/AML.**

**Build:**
- Store per client/run: `run_items` kind `crosssell` (or `clients.facts.crosssell`) =
  `[{ service, status: 'na'|'flagged'|'proposed'|'won', note, estRevenue? }]`. Seed the 6 services above.
- UI: a "Cross-sell opportunities" card on the kickoff/call step (a new `act: { type: "crosssell" }`
  modal) AND on the client playbook. Each row: toggle relevance + note. VAT-reg row prompts for
  estimated annual revenue (flag if > AED 375k mandatory / 187.5k voluntary). CT-reg row flags if
  taxable. Show a summary count ("3 opportunities flagged").
- Roll flagged opportunities into the Pulse management digest + (optional) notify the AM/sales.

**Acceptance:** on the call step, team ticks which services are relevant; flagged items show on the
playbook + feed the digest. UAE thresholds referenced for VAT/CT prompts.

---

## Item 5 — Auto WEEKLY CLIENT digest of tasks (configurable)  ☐

**Goal:** a weekly, client-facing email summarising their tasks/status/what's needed from them; per-run
configurable (on/off, day, recipients); auto-sent.

**Build (copy the Pulse digest pattern):**
- Config: `run_items` kind `client_digest_cfg` `{ enabled, weekday (0-6), recipients[] (default the
  portal email + alt_emails), lastSentAt }`. Small "Weekly client update" toggle on the Client Portal
  team tab.
- Generation: `generateClientDigest(runId)` — gather client-visible tasks (status), open client actions
  (docs needed, access pending, intake), upcoming compliance → `runAi(orgId, "welcome_email" or
  "brief", {...})` → friendly, simple, branded client email (NO internal/team detail; never expose
  other clients). Reuse Finanshels branding tone.
- Cron `/api/cron/client-digest` (add to vercel.json, daily; send to runs whose `weekday===today` &&
  enabled && not already sent this week) → `sendGmailAs` from the AM's Gmail (per-AM Gmail connect is
  the deliverability fix — see notes). Dedup via `lastSentAt`.
- Manual "Send now / Preview" button on the team Client Portal tab.

**Acceptance:** enable on a run → a simple weekly task digest emails to the client on the chosen day;
preview + send-now available; no cross-client leakage.

---

## Item 6 — On-page BUSINESS + COMPLIANCE SUMMARY (after call + docs)  ☐

**Goal:** once call notes + documents are in, generate an on-page summary of the client's business and
their compliance position (what's registered, what's due, gaps), viewable in-app (team + maybe portal).

**Build:**
- `generateClientSummary(clientId)` in `clients/actions.ts` — inputs: `business_description`,
  `call_insights`, `pain_points`, intake answers, `clients.facts`, the compliance items
  (`run_items` compliance / extracted dates), VAT/CT/TRN fields, documents list. → `runAi(orgId,
  "handover_summary", {...})` → structured summary: (a) Business overview, (b) Registrations (VAT/CT/
  trade licence + expiries), (c) Compliance position & gaps, (d) What we'll do. NO invented facts;
  say what's missing.
- Store on `clients.facts.summary` or a column `clients.business_summary` (migration); show a
  "Business & compliance summary" card on the Company Overview tab with a "Generate / refresh" button
  (gated to team). Optionally surface a read-only version on the portal Live tab.
- Auto-trigger hint: enable the button once `call_insights` present AND ≥1 document uploaded.

**Acceptance:** after a call + a doc upload, "Generate summary" produces an accurate on-page business +
compliance summary; refreshable; honest about gaps.

---

## Item 7 — CUSTOM CLIENT CODE (sequence + licence + contract start)  ☐

**Goal:** every client gets a custom code. Format (per Munees): a sequence prefix + trade licence
number, tied to the contract start date — example seed prefix **`2601`**, i.e. `2601-<licenceNumber>`.
Build from the Drive trade-licence if present; else the team enters licence # + contract start date in
the Clients tab and the code is generated.

**INTERPRETATION / OPEN Q (confirm with Munees before building):**
  - Is `2601` = **YY MM of contract start** (2026-01 → "2601")? OR a **running sequence** starting at
    2601 that increments per client? The phrase "start with Seq - 2601" + "when contract started date
    mentioned" suggests **YYMM-of-contract-start + licence number**, e.g. contract start Jan 2026,
    licence `1234567` → `2601-1234567`. ASSUME this unless told otherwise; make the prefix logic a
    single helper so it's easy to switch to a running counter.

**Build:**
- Migration `0027`(or next): `clients.custom_code text`, `clients.trade_licence_no text`,
  `clients.contract_start_date date` (some may exist — check first).
- Helper `buildClientCode(licenceNo, contractStart)` → `${YY}${MM}-${licenceNo}` (YYMM from contract
  start). Pure function in a lib so it's testable + reusable.
- Drive auto-source: a server action `deriveClientCodeFromDrive(clientId)` — find the trade-licence
  doc in the client Drive folder (reuse `listDriveDocsByFolderId` + the OpenAI file-extract used in
  `generateComplianceFromDocs` to read the licence number + issue date), set `trade_licence_no` and,
  if contract start known, `custom_code`. If contract start missing, leave code pending.
- Clients tab UI (Company Overview): a "Client code" card — shows the code; if missing, inputs for
  **licence number** + **contract start date** → Save → builds + stores the code. "Pull from Drive"
  button to auto-fill the licence number.
- Backfill: a one-off admin action (like `backfillDriveFolders`) to generate codes for all current
  clients that have licence# + contract start (and try Drive for the rest).
- Show the code on the clients list + playbook header.

**Acceptance:** entering licence# + contract start (or pulling from Drive) produces `2601-<licence>`
format; visible on the client; backfill covers existing clients where data exists.

---

## Suggested execution order
1. **Deploy the existing session first** (`npx vercel … --archive=tgz`) so nothing is lost.
2. Item 7 (custom code) — small, self-contained, unblocks client-code everywhere. CONFIRM format first.
3. Item 1 (tax codes) — high value, clean COA-clone.
4. Item 6 (business+compliance summary) — reuses existing data, AI-only.
5. Item 4 (cross-sell checklist) — small, feeds digests.
6. Item 2 (compliance alerts) — extends existing cron.
7. Item 3 (onboarding SLA) — needs stage-timestamp groundwork. CONFIRM targets.
8. Item 5 (client weekly digest) — copy Pulse; depends on per-AM Gmail for deliverability.

## Cross-cutting reminders
- After ANY `actions.ts` edit: grep for non-async exports (`^export (const|let|var|class|default)`).
- After ANY built-in template edit: patch the **DB** `onboarding_templates.data` too.
- Migrations: session pooler (`:6543`→`:5432`). Next number after 0026 = **0027**.
- `tsc --noEmit` must be clean. Verify in preview (login via requestSubmit). Update this file's ☐→☑.
- Honour AI house rules: never invent; if data missing, say so; client-facing content never leaks
  other clients or internal notes.

## Open questions to confirm with Munees
1. Item 7: custom-code prefix — YYMM-of-contract-start, or a running sequence from 2601?
2. Item 3: the SLA day targets per stage.
3. Item 1: org-level Master Tax Codes editor needed, or per-client only?
4. Item 5: default send day for the client weekly digest; from which sender (per-AM Gmail recommended).
