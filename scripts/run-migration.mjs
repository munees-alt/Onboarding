// Run a single migration file directly.
// Usage: node --env-file=.env.local scripts/run-migration.mjs 0049_user_points_auto.sql
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error("Usage: node run-migration.mjs <filename.sql>"); process.exit(1); }
const filePath = path.join(__dirname, "..", "supabase", "migrations", file);

async function connect() {
  const candidates = [
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["SESSION_POOLER", (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/")],
  ].filter(([, v]) => v);
  for (const [name, conn] of candidates) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`✗ ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const client = await connect();
const sql = await readFile(filePath, "utf8");
try {
  await client.query(sql);
  console.log(`✓ ${file} applied.`);
} catch (e) {
  console.error(`✗ ${file}: ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
