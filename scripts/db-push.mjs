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

for (const f of files) {
  const sql = await readFile(path.join(migrationsDir, f), "utf8");
  process.stdout.write(`→ ${f} ... `);
  try {
    await client.query(sql);
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    console.error(e.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("\n✓ All migrations applied.");
