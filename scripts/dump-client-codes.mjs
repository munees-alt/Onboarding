import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`select name, custom_code, trade_licence_no, contract_start_date from clients order by name`);
for (const r of rows) console.log(`${r.name.padEnd(45)} ${r.custom_code ?? "(none)"} | TL=${r.trade_licence_no ?? "—"} | start=${r.contract_start_date ?? "—"}`);
await c.end();
