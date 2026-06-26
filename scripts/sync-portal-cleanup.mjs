// One-time / idempotent sync. Walks every onboarding_templates row and:
//   1) Drops the early "Send intake form to client" dispatch step (the t1.1a /
//      m1.1a / e1.1a / x1.1a addition from the move-intake-step.mjs run).
//   2) Restores the remaining "Re-send portal link (optional)" dispatch step
//      back to a single primary "Send (or re-send) the onboarding portal link"
//      step (drops act.optional, retitles, refreshes the note + button).
//   3) If the template has NO dispatch step left, inserts one in Stage 2 (or
//      after the Drive-link step for Micro-2).
//   4) Renames any stage named "Client Portal Setup" → "Onboarding Portal Setup".
//      Cleans up "client portal" → "onboarding portal" inside stage descriptions.
//   5) For Micro-2 specifically: inserts the Optional Operations (x4b) stage
//      between Welcome (x4) and Catch-up (x5) if it isn't there yet.
//
// Run: node --env-file=.env.local scripts/sync-portal-cleanup.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const INTAKE_TITLE = "Send intake form to client";
const RESEND_TITLE_PREFIX = "Re-send portal link";
const PRIMARY_TITLE = "Send (or re-send) the onboarding portal link";
const PRIMARY_NOTE = "Generates the secure onboarding portal magic link plus ready-to-send email + WhatsApp templates. Use this step to dispatch the link for the first time AND to re-send if the client lost it. Add extra teammate emails who should also be able to open the portal — they're saved to the link and the templates are re-sent to all of them.";
const PRIMARY_BTN = "Send / re-send portal link";

// The Optional Operations stage we want on Micro-2 — mirrors t4b / m4b.
const MICRO2_OPTIONAL_OPS = {
  id: "x4b",
  name: "Optional Operations",
  targetDays: 1,
  optional: true,
  desc: "Decide if catch-up bookkeeping or urgent compliance is needed. Configure both, then Senior confirms before we move on.",
  steps: [
    { id: "x4b.1", title: "Catch-up account configuration", kind: "person", who: ["AM"], note: "Decide if the client needs catch-up bookkeeping. If yes, choose the catch-up service scope and assign a Senior to lead it. If no, this step is skipped and we move on.", act: { type: "catchup_config", btn: "Configure catch-up" } },
    { id: "x4b.2", title: "Urgent compliance configuration", kind: "person", who: ["AM"], note: "Decide if there's any urgent compliance (FTA escalation, VAT/CT cleanup, penalties). If yes, choose what's needed and who handles it; we'll spin up a parallel run.", act: { type: "urgent_config", btn: "Configure urgent compliance" } },
    { id: "x4b.3", title: "Senior confirms operational setup complete", kind: "person", who: ["Senior"], approval: { by: "Senior" }, note: "Senior reviews catch-up + urgent-compliance configuration before we proceed.", act: { type: "approve", role: "Senior", btn: "Confirm complete" } },
  ],
  gate: { label: "Senior confirmation", after: "x4b.3", sop: "Senior signs off the optional operations setup before we move to delivery." },
};

const { data: rows, error } = await db.from("onboarding_templates").select("id,name,data");
if (error) { console.error(error); process.exit(1); }

const report = [];

for (const row of rows ?? []) {
  const tpl = row.data;
  if (!tpl?.stages?.length) { report.push({ template: row.name, change: "no stages" }); continue; }

  const changes = [];

  // ── 1) Drop the early "Send intake form to client" dispatch step ──────────
  for (const stage of tpl.stages) {
    if (!Array.isArray(stage.steps)) continue;
    const before = stage.steps.length;
    stage.steps = stage.steps.filter((s) => !(s?.act?.type === "dispatch" && s?.title === INTAKE_TITLE));
    if (stage.steps.length < before) changes.push(`dropped intake-send step from ${stage.id}`);
  }

  // ── 2) Collect all remaining dispatch steps so we can keep exactly one ────
  const dispatchRefs = [];
  for (const stage of tpl.stages) {
    for (const step of stage.steps ?? []) {
      if (step?.act?.type === "dispatch") dispatchRefs.push({ stage, step });
    }
  }

  if (dispatchRefs.length === 0) {
    // No dispatch step left — insert one. Prefer Stage 2 (the "Send Magic
    // Link" / "Onboarding Portal Setup" stage). Fall back to first stage.
    const target = tpl.stages[1] ?? tpl.stages[0];
    const insertIdx = (target.steps?.length ?? 0);
    const lastId = target.steps?.[insertIdx - 1]?.id ?? `${target.id}.0`;
    const prefix = (lastId.match(/^[a-z]+\d+/i)?.[0]) ?? `${target.id}`;
    target.steps.push({
      id: `${prefix}.dispatch`,
      title: PRIMARY_TITLE,
      kind: "link",
      who: ["AM"],
      note: PRIMARY_NOTE,
      act: { type: "dispatch", btn: PRIMARY_BTN },
    });
    changes.push(`inserted dispatch step into ${target.id}`);
  } else {
    // Keep the first one as the primary; drop any duplicates (e.g. the
    // "Re-send portal link" optional variant). Restore the primary's title /
    // note / button + drop the optional flag.
    const [primary, ...extras] = dispatchRefs;
    if (extras.length > 0) {
      for (const { stage, step } of extras) {
        stage.steps = stage.steps.filter((s) => s !== step);
        changes.push(`dropped duplicate dispatch ${step.id} from ${stage.id}`);
      }
    }

    let touched = false;
    if (primary.step.title !== PRIMARY_TITLE) {
      primary.step.title = PRIMARY_TITLE;
      touched = true;
    }
    if (primary.step.note !== PRIMARY_NOTE) {
      primary.step.note = PRIMARY_NOTE;
      touched = true;
    }
    primary.step.kind = "link";
    primary.step.who = ["AM"];
    const newAct = { ...primary.step.act, btn: PRIMARY_BTN };
    delete newAct.optional;
    delete newAct.intake;
    if (JSON.stringify(primary.step.act) !== JSON.stringify(newAct)) {
      primary.step.act = newAct;
      touched = true;
    }
    if (touched) changes.push(`refreshed primary dispatch ${primary.step.id}`);
  }

  // ── 3) Rename "Client Portal Setup" → "Onboarding Portal Setup" + light
  //      string-cleanup of "client portal" inside stage descriptions/notes ──
  for (const stage of tpl.stages) {
    if (stage.name === "Client Portal Setup") {
      stage.name = "Onboarding Portal Setup";
      changes.push(`renamed stage ${stage.id} → Onboarding Portal Setup`);
    }
    if (typeof stage.desc === "string" && / client portal/.test(stage.desc)) {
      stage.desc = stage.desc.replace(/ client portal/g, " onboarding portal");
      changes.push(`cleaned client-portal copy in ${stage.id}.desc`);
    }
    for (const step of stage.steps ?? []) {
      if (typeof step.note === "string" && / client portal/.test(step.note)) {
        step.note = step.note.replace(/ client portal/g, " onboarding portal");
        changes.push(`cleaned client-portal copy in ${stage.id}/${step.id}.note`);
      }
    }
  }

  // ── 4) Optional Operations stage — Micro-2 (x4b), Medium-Team (t4b),
  //      Micro-Team (m4b). Code already has t4b/m4b but DB rows don't, so we
  //      port them in. Sits between the Welcome / Call stage and Catch-up.
  if (row.id === "micro-2") {
    const hasOps = tpl.stages.some((s) => s.id === "x4b");
    if (!hasOps) {
      const welcomeIdx = tpl.stages.findIndex((s) => s.id === "x4");
      const insertAt = welcomeIdx >= 0 ? welcomeIdx + 1 : tpl.stages.length;
      tpl.stages.splice(insertAt, 0, structuredClone(MICRO2_OPTIONAL_OPS));
      changes.push(`inserted x4b Optional Operations after x4`);
    }
  }
  if (row.id === "medium-team" || row.id === "micro-team") {
    const prefix = row.id === "medium-team" ? "t" : "m";
    const targetStageId = `${prefix}4b`;
    const hasOps = tpl.stages.some((s) => s.id === targetStageId);
    if (!hasOps) {
      const ops = structuredClone(MICRO2_OPTIONAL_OPS);
      ops.id = targetStageId;
      ops.steps = ops.steps.map((s) => ({ ...s, id: s.id.replace(/^x4b/, targetStageId) }));
      ops.gate = { ...ops.gate, after: `${targetStageId}.3` };
      // Insert after the Call stage (t4 / m4) — falls back to end.
      const callIdx = tpl.stages.findIndex((s) => s.id === `${prefix}4`);
      const insertAt = callIdx >= 0 ? callIdx + 1 : tpl.stages.length;
      tpl.stages.splice(insertAt, 0, ops);
      changes.push(`inserted ${targetStageId} Optional Operations`);
    }
  }

  // ── 5) Medium-Enterprise cleanup: e2.3 is a dummy "dispatched" status step
  //      with no act — superseded by the dispatch step we just inserted.
  //      Removing it avoids a confusing duplicate row in the stage.
  if (row.id === "medium-enterprise") {
    for (const stage of tpl.stages) {
      if (!Array.isArray(stage.steps)) continue;
      const before = stage.steps.length;
      stage.steps = stage.steps.filter((s) => !(s?.id === "e2.3" && !s?.act));
      if (stage.steps.length < before) changes.push(`removed dummy e2.3 status step`);
    }
  }

  if (!changes.length) { report.push({ template: row.name, change: "no-op" }); continue; }
  const { error: uErr } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", row.id);
  if (uErr) { report.push({ template: row.name, change: changes.join("; "), error: uErr.message }); continue; }
  report.push({ template: row.name, change: changes.join("; ") });
}

console.log("Result:");
console.table(report);
