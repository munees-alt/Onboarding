// Collapse the post-call MOM steps into ONE "Welcome email" step across all
// DB-stored onboarding templates (runtime reads templates from the DB, so this
// updates existing runs too).
//
// Old design had two steps in the "Call with Client" stage:
//   .2  kind=ai,  act.type=ai,  "AI generates Minutes of Meeting" / "Generate MOM"
//   .3  kind=link, act.type=mom, "Send MOM to client" / "Open MOM email"
// New design: a single step that generates AND sends the welcome email
// (act.type="mom" → AiTextModal builds the welcome-email template).
//
// We keep the FIRST mom/minutes/welcome step in each stage, turn it into the
// welcome step, and drop the rest. Idempotent.
// Run: node --env-file=.env.local scripts/sync-welcome-email.mjs
import pg from "pg";

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const WELCOME = {
  title: "Welcome email — review & send",
  note: "Builds the welcome email from the saved template: the client's name, company and portal link are filled in, plus the AI-drafted minutes of the meeting (from your call notes). Review, edit, then send — one step. Dispatch the portal magic link first.",
  btn: "Generate welcome email",
};

// A step that is part of the post-call MOM/welcome flow.
const isMomFlowStep = (s) => {
  const t = (s.title || "").toLowerCase();
  const btn = (s.act?.btn || "").toLowerCase();
  if (s.act?.type === "mom") return true;
  if (s.act?.type === "ai" && (/minutes/.test(t) || /\bmom\b/.test(t) || /\bmom\b/.test(btn))) return true;
  if (/send\s+mom/.test(t) || /mom\s+email/.test(btn) || /open\s+mom/.test(btn)) return true;
  return false;
};

const db = await connect();
try {
  const { rows } = await db.query("select id, data from onboarding_templates order by id");
  for (const { id, data } of rows) {
    let changed = false;
    for (const stage of data.stages ?? []) {
      const momSteps = stage.steps.filter(isMomFlowStep);
      if (!momSteps.length) continue;
      const keep = momSteps[0];
      const drop = new Set(momSteps.slice(1));
      // Turn the kept step into the single welcome-email step.
      const already = keep.kind === "ai" && keep.act?.type === "mom" && keep.title === WELCOME.title && keep.act?.btn === WELCOME.btn;
      keep.kind = "ai";
      keep.who = keep.who && keep.who.length ? keep.who : ["AI", "AM"];
      keep.title = WELCOME.title;
      keep.note = WELCOME.note;
      keep.act = { type: "mom", btn: WELCOME.btn };
      stage.steps = stage.steps.filter((s) => !drop.has(s));
      if (!already || drop.size) changed = true;
    }
    if (changed) {
      await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
      console.log(`+ ${id}: collapsed to single welcome-email step`);
    } else {
      console.log(`= ${id}: already a single welcome-email step`);
    }
  }
} finally {
  await db.end();
}
console.log("Done.");
