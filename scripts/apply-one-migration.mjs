// Apply a single SQL file. Usage: node --env-file=.env.local scripts/apply-one-migration.mjs <relative-or-abs-path>
import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node --env-file=.env.local scripts/apply-one-migration.mjs <file>");
  process.exit(1);
}
const fullPath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
const sql = await readFile(fullPath, "utf8");

async function connect() {
  const candidates = [
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
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
  throw new Error("Could not connect to the database.");
}

const client = await connect();
try {
  await client.query(sql);
  console.log(`✓ Applied ${path.basename(fullPath)}`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
