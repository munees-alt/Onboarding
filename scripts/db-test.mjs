// Quick connectivity check. Run: node --env-file=.env.local scripts/db-test.mjs
import pg from "pg";

const targets = [
  ["DIRECT_URL", process.env.DIRECT_URL],
  ["DATABASE_URL", process.env.DATABASE_URL],
];

for (const [name, conn] of targets) {
  if (!conn) {
    console.log(`- ${name}: (not set)`);
    continue;
  }
  const client = new pg.Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const r = await client.query(
      "select current_database() db, current_user usr, version() v",
    );
    console.log(
      `✓ ${name}: connected as ${r.rows[0].usr} → ${r.rows[0].db}\n   ${r.rows[0].v.split(",")[0]}`,
    );
    await client.end();
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    try {
      await client.end();
    } catch {}
  }
}
