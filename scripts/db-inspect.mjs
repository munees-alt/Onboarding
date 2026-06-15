import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = await c.query(`
  select table_name, (select count(*) from information_schema.columns col where col.table_name = t.table_name and col.table_schema='public') cols
  from information_schema.tables t
  where table_schema='public' and table_type='BASE TABLE'
  order by table_name`);
console.log("PUBLIC TABLES:");
for (const r of tables.rows) console.log(`  ${r.table_name} (${r.cols} cols)`);

for (const tn of ["orgs", "clients", "team_members", "profiles"]) {
  const cols = await c.query(
    `select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [tn]);
  if (cols.rows.length) {
    console.log(`\n${tn}:`);
    for (const r of cols.rows) console.log(`  ${r.column_name} ${r.data_type} ${r.is_nullable === "NO" ? "NOT NULL" : ""}`);
    const cnt = await c.query(`select count(*)::int n from "${tn}"`);
    console.log(`  rows: ${cnt.rows[0].n}`);
  }
}
await c.end();
