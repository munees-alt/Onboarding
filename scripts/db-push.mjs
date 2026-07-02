// Apply all SQL migrations in supabase/migrations in order.
// Run: node --env-file=.env.local scripts/db-push.mjs
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");

async function connect() {
  const candidates = [
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    // On networks where the direct db host (:5432) and txn pooler (:6543) are firewalled,
    // the SESSION pooler (pooler host on :5432) is reachable and supports DDL.
    ["SESSION_POOLER", (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/")],
  ].filter(([, v]) => v);

  for (const [name, conn] of candidates) {
    const client = new pg.Client({
      connectionString: conn,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${name}`);
      return client;
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error("Could not connect to the database with any connection string.");
}

const client = await connect();
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

// Ledger of applied migrations, so we only run each file ONCE. Without this the
// runner replayed every file on every push — fine for idempotent DDL, but
// non-idempotent migrations (e.g. 0051 re-adding a CHECK constraint that newer
// data now violates) would fail on an already-migrated DB.
await client.query(`
  create table if not exists _migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  )
`);
const appliedRows = await client.query("select filename from _migrations");
const applied = new Set(appliedRows.rows.map((r) => r.filename));

// Baseline an existing, already-migrated database: if the ledger is empty but
// the schema already exists (orgs table present), record every current file as
// applied WITHOUT re-running it. A genuinely fresh DB (no orgs) skips baselining
// and runs all migrations normally below.
if (applied.size === 0) {
  const { rows } = await client.query("select to_regclass('public.orgs') as t");
  const existingDb = rows[0]?.t != null;
  if (existingDb) {
    for (const f of files) {
      await client.query("insert into _migrations (filename) values ($1) on conflict do nothing", [f]);
      applied.add(f);
    }
    console.log(`Baselined existing database: ${files.length} migration(s) marked as already applied.`);
  }
}

let ran = 0;
for (const f of files) {
  if (applied.has(f)) {
    console.log(`• ${f} ... skip (already applied)`);
    continue;
  }
  const sql = await readFile(path.join(migrationsDir, f), "utf8");
  process.stdout.write(`→ ${f} ... `);
  try {
    await client.query(sql);
    await client.query("insert into _migrations (filename) values ($1) on conflict do nothing", [f]);
    ran++;
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    console.error(e.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n✓ Migrations up to date (${ran} newly applied, ${applied.size} already on record).`);
