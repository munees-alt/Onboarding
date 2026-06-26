// Backfill clients.custom_code = F01-{TL#}-{CoFirst}-{YYMM}
// Reads any existing trade_licence_no / contract_start_date; falls back to
// each client's earliest onboarding_run.started_at for the contract start.
// Unknown chunks become TBD so master admin can fix them after.
// Run: node --env-file=.env.local scripts/backfill-custom-codes.mjs
import pg from "pg";

function connect() {
  const candidates = [
    process.env.DATABASE_URL,
    (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/"),
  ].filter(Boolean);
  return Promise.any(
    candidates.map(async (cs) => {
      const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
      await c.connect();
      return c;
    }),
  );
}

function firstWord(name) {
  if (!name) return "TBD";
  const cleaned = name
    .replace(/\b(llc|fzc|fzco|fz-llc|fz-co|fz|free zone|sole establishment|company|co\.?|ltd\.?|limited|holding|holdings|the|inc\.?|corp\.?)\b/gi, " ")
    .replace(/[^a-z0-9 ]/gi, " ")
    .trim();
  const first = (cleaned.split(/\s+/)[0] || name.trim().split(/\s+/)[0] || "").replace(/[^a-z0-9]/gi, "");
  if (!first) return "TBD";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function tlChunk(licence) {
  if (!licence) return "TBD";
  const d = String(licence).replace(/[^0-9a-z]/gi, "");
  return d || "TBD";
}

function startChunk(date) {
  if (!date) return "TBD";
  const m = /^(\d{4})-(\d{2})/.exec(typeof date === "string" ? date : date.toISOString());
  if (!m) return "TBD";
  return m[1].slice(2) + m[2];
}

const c = await connect();
const { rows } = await c.query(`
  select c.id, c.name, c.trade_licence_no, c.contract_start_date, c.custom_code,
         (select min(started_at) from onboarding_runs r where r.client_id = c.id) as first_run_start,
         (select created_at::date from onboarding_runs r where r.client_id = c.id order by created_at limit 1) as first_run_created
  from clients c
  order by c.created_at asc
`);

let updated = 0;
for (const r of rows) {
  const tl = r.trade_licence_no;
  const start = r.contract_start_date ?? r.first_run_start ?? r.first_run_created;
  const code = ["F01", tlChunk(tl), firstWord(r.name), startChunk(start)].join("-");
  if (code === r.custom_code) continue;
  // Only write the contract_start_date back if it was empty AND we found a fallback
  const willBackfillStart = !r.contract_start_date && start ? start : null;
  await c.query(
    `update clients set custom_code = $1${willBackfillStart ? ", contract_start_date = $2" : ""} where id = $${willBackfillStart ? 3 : 2}`,
    willBackfillStart ? [code, willBackfillStart, r.id] : [code, r.id],
  );
  console.log(`${r.name.padEnd(45)} → ${code}`);
  updated++;
}
console.log(`\n${updated} client code(s) updated of ${rows.length} total.`);
await c.end();
