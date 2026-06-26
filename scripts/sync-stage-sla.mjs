// Inject default stage targetDays into existing DB-stored templates so the
// onboarding-SLA cron has thresholds to compare against. Idempotent —
// re-running just refreshes the same values.

import pg from "pg";

const DEFAULTS = {
  "medium-team": { t1: 1, t2: 2, t3: 5, t4: 7, t6: 2 },
  "micro-team":  { m1: 1, m2: 2, m3: 5, m4: 7 },
  "micro-2":     { m1: 1, m2: 2, m3: 5, m4: 7 },
};

function connStr() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL not set");
  return raw.replace(":6543/", ":5432/");
}

async function main() {
  const client = new pg.Client({ connectionString: connStr(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  let patched = 0;
  for (const [tplId, targets] of Object.entries(DEFAULTS)) {
    const { rows } = await client.query("select data from onboarding_templates where id=$1", [tplId]);
    if (!rows.length) { console.log(`  - ${tplId}: not in DB, skip`); continue; }
    const data = rows[0].data;
    let changed = false;
    for (const stage of data.stages ?? []) {
      if (targets[stage.id] && stage.targetDays !== targets[stage.id]) {
        stage.targetDays = targets[stage.id];
        changed = true;
      }
    }
    if (!changed) { console.log(`  - ${tplId}: already up to date`); continue; }
    await client.query("update onboarding_templates set data=$1, updated_at=now() where id=$2", [data, tplId]);
    console.log(`  ✓ ${tplId}: stage targetDays set`);
    patched++;
  }
  await client.end();
  console.log(`Done. ${patched} template${patched === 1 ? "" : "s"} patched.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
