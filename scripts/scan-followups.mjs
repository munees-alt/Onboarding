// One-shot verification: hit the admin-tasks cron and dump the resulting
// admin_tasks rows for the 10 named clients we care about.
//
//   node --env-file=.env.local scripts/scan-followups.mjs

import pg from "pg";

const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

async function callScan() {
  const res = await fetch(`${base}/api/cron/admin-tasks`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`cron returned ${res.status}: ${t}`);
  }
  return res.json();
}

async function connect() {
  const candidates = [
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["SESSION_POOLER", (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/")],
  ].filter(([, v]) => v);
  for (const [name, conn] of candidates) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      console.log(`Connected via ${name}`);
      return client;
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error("No DB connection succeeded.");
}

const TARGETS = [
  "BluTalent Human Resources Consultancies Co LLC",
  "EMARGROW FZE LLC",
  "Novamed Rescue Medical Treatment",
  "Al Hussein Group FZE",
  "BSK IT Consulting FZE",
  "ALTARYON GLOBAL ENERGY COMMODITY TRADING FZCO",
  "Stream freight LLC FZ",
  "Cross Border Consultancy FZCO",
  "TRINOVATE TECHNOLOGIES - FZCO",
  "FRESH DAILY BAKERY PRODUCTS MANUFACTURING L.L.C",
];

let scanResult = null;
try {
  scanResult = await callScan();
  console.log("Scan result:", JSON.stringify(scanResult));
} catch (e) {
  console.log("Scan call failed (likely no dev server running):", e.message);
}

const db = await connect();
try {
  for (const name of TARGETS) {
    const { rows: clients } = await db.query("select id from clients where lower(name) = lower($1)", [name]);
    if (!clients.length) { console.log(`\n— ${name} — (client not found)`); continue; }
    const clientId = clients[0].id;
    const { rows } = await db.query(
      `select at.kind, at.status, at.title, at.owner_id, tm.full_name as owner_name, at.created_at
         from admin_tasks at
         left join team_members tm on tm.id = at.owner_id
        where at.client_id = $1
        order by at.created_at desc`,
      [clientId],
    );
    console.log(`\n— ${name} (${rows.length} task row${rows.length === 1 ? "" : "s"})`);
    for (const r of rows) {
      console.log(`  [${r.status}] ${r.kind} → ${r.owner_name ?? r.owner_id} · ${r.created_at.toISOString?.() ?? r.created_at}`);
    }
  }
} finally {
  await db.end();
}
