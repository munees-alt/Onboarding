// Append this session's decisions + Batch 23 ship items + Gautham's feedback
// items into pulse_entries so the next weekly management digest reflects current
// reality.
//
// Run: node --env-file=.env.local scripts/seed-pulse-batch23.mjs

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: org } = await db.from("orgs").select("id,name").limit(1).maybeSingle();
if (!org?.id) { console.error("No org found"); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);

const ENTRIES = [
  // Batch 23 shipped
  { category: "feature",     title: "Public no-login intake link (Stage 1 first step)",                       detail: "Separate from the OTP-gated client portal. Token-only URL /intake/<token>, autosaves each field, team sees responses live in the run view. Replaces the portal-based intake for new clients." },
  { category: "improvement", title: "Dashboard full-width fix across My Work / Onboarding / Clients",         detail: "Removed the 1480px cap on .page so the screens use the full viewport — no more blank right column." },
  { category: "improvement", title: "Fathom MoM now keeps action items, decisions, next steps",               detail: "Bumped output token cap from 1500 to 2800, sharpened the prompt to require all 3 headers, captured assignee/due-date on action items, softened cleanMinutes so trailing content sections aren't stripped." },
  { category: "improvement", title: "Team Lead can assign + configure without waiting on AM (Gautham)",       detail: "Step-role gating was already off. Assign-cascade now falls back to the org-scoped pool when the upstream slot is empty, so TL isn't blocked by AM inaction." },
  { category: "improvement", title: "Task assignee auto-added to run team + notification (Gautham)",          detail: "addTask/updateTask now upsert the owner into run_team (so the run appears in their chat + work list) and fire a 'New task assigned to you' notification." },
  { category: "improvement", title: "Removed Vercel cron entries — sync is fully manual",                     detail: "vercel.json crons emptied. 'Sync from email' and 'Sync from Fathom' buttons remain. No Vercel plan upgrade needed." },

  // Batch 24 queue
  { category: "todo", title: "Batch 24 — Industry-tailored tax codes (like COA)", status: "open", detail: "RCM / zero-rated / exempt codes, per-industry, generated post-call. Builder modal + tax_code_sets table." },
  { category: "todo", title: "Batch 24 — Compliance alert ladder",                 status: "open", detail: "Multi-stage lead-times (60/30/14/7/0 days), in-app + email reminders, dedup per stage." },
  { category: "todo", title: "Batch 24 — Onboarding SLA tracking",                 status: "open", detail: "Per-stage targets + breach alerts. Task SLA already live." },
  { category: "todo", title: "Batch 24 — Weekly client task digest",               status: "open", detail: "Clone Pulse pattern, send each client a weekly task summary. Manual + scheduled." },
  { category: "todo", title: "Batch 24 — One-page business + compliance summary",  status: "open", detail: "generateClientSummary — AI-stitched from intake + call + docs, lands on the client playbook." },
  { category: "todo", title: "Batch 24 — Custom client code 2601-<licence#>",      status: "open", detail: "From contract-start YYMM + Drive trade-licence number." },
  { category: "todo", title: "Batch 24 — Custom (free-text) access type",          status: "open", detail: "Today only predefined ACCESS_TYPES are editable; add brand-new ones." },

  // Batch 25 queue
  { category: "todo", title: "Batch 25 — Unified playbook page (meetings + collected + given → one page)", status: "open", detail: "Kill the tab split. One scrollable page per client." },
  { category: "todo", title: "Batch 25 — Template editor (visual stage/step CRUD)", status: "open", detail: "Templates are DB-backed; editing requires a script today. Need a real UI." },
  { category: "todo", title: "Batch 25 — Auto-assignment based on overdue (Gautham)", status: "open", detail: "When a member's tasks go red past N days, new steps auto-route to a lighter-loaded peer of the same role." },
  { category: "todo", title: "Batch 25 — Simplified one-time compliance client mode (Gautham)", status: "open", detail: "Strip the run down to a document-collection form for clients on the URGENT_COMPLIANCE template." },
  { category: "todo", title: "Batch 25 — Audit + improve URGENT_COMPLIANCE template (Gautham)", status: "open", detail: "Existing template from batch 5; verify it covers the doc-only one-time-client flow and that the team can drive it end-to-end." },

  // Batch 26 queue
  { category: "todo", title: "Batch 26 — Handover routing (pick → sign-off)", status: "open", detail: "On handover stage, pick the destination team member; their sign-off step auto-routes to them." },
  { category: "todo", title: "Batch 26 — Multi-entity support", status: "open", detail: "One client → multiple legal entities. Unlocks white-label resale." },
  { category: "todo", title: "Batch 26 — Zoho COA write-push", status: "open", detail: "Push the built COA into Zoho Books via API. Read connection ready." },

  // Decisions confirmed this session
  { category: "feedback", title: "Skipped: cross-sell checklist on the call", detail: "User chose not to build." },
  { category: "feedback", title: "Skipped: column-config everywhere", detail: "Task board only. COA/items/compliance stay structured." },
  { category: "feedback", title: "Skipped: expansion-revenue pipeline (5.3)", detail: "User chose not to build." },
  { category: "feedback", title: "Skipped: backfilling Avobar to Fathom", detail: "User said no need." },

  // Focus + standing strategic note
  { category: "focus", title: "Next dollar of build = compliance OS (Batch 24)", detail: "Tax codes + alerts + SLA + auto-summary. 12+ month moat for anyone replicating. Wedge to $100M." },
  { category: "focus", title: "Then multi-entity (Batch 26) for firm-agnostic resale", detail: "Where the $1B optionality lives — letting other Gulf accounting firms run Cadence." },

  // Open user actions
  { category: "todo", title: "Munees: Reconnect Google for gmail.readonly", status: "done", detail: "Reported done by user 2026-06-24." },
  { category: "todo", title: "Munees: Set CRON_SECRET in Vercel", status: "done", detail: "Crons removed instead — no longer needed." },
  { category: "todo", title: "Munees: Vercel cron plan", status: "done", detail: "Crons removed — no plan upgrade required." },
];

const rows = ENTRIES.map((e) => ({
  org_id: org.id,
  category: e.category,
  title: e.title,
  detail: e.detail ?? null,
  status: e.status ?? null,
  entry_date: today,
  source: "batch23-seed",
  created_by: "claude",
}));

const { error } = await db.from("pulse_entries").insert(rows);
if (error) { console.error(error); process.exit(1); }

console.log(`Inserted ${rows.length} pulse entries for ${org.name}.`);
