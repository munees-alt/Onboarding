// Audit every client: what structured fields are populated vs. blank.
// Run: node --env-file=.env.local scripts/audit-client-completeness.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const colsRes = await pgc.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='clients' order by ordinal_position`,
);
const clientCols = new Set(colsRes.rows.map((r) => r.column_name));
const runColsRes = await pgc.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='onboarding_runs' order by ordinal_position`,
);
const runCols = new Set(runColsRes.rows.map((r) => r.column_name));
await pgc.end();

const wantedCli = [
  "id","name","industry","entity_type","trade_license","vat_trn","owner_name","email","phone",
  "business_description","pain_points","call_link","call_notes","call_summary","call_insights",
  "revenue_channels","bank_names","payment_gateways","accounting_software","vat_registered",
  "ct_registered","services","revenue_bracket","assigned_am","status","created_at","group_id",
  "country","country_code","contact_person","entity","client_code",
];
const selCli = wantedCli.filter((c) => clientCols.has(c)).join(",");

const { data: org } = await db.from("orgs").select("id,name").order("created_at").limit(1).single();
const orgId = org.id;
const { data: clients, error } = await db
  .from("clients").select(selCli).eq("org_id", orgId)
  .order("created_at", { ascending: false });
if (error) { console.error(error); process.exit(1); }

const wantedRun = ["id","client_id","template_id","stage_idx","status","assigned_am","team_lead","senior","junior","am_member_id","tl_member_id","sr_member_id","jr_member_id"];
const selRun = wantedRun.filter((c) => runCols.has(c)).join(",");
const { data: runs } = await db.from("onboarding_runs").select(selRun).eq("org_id", orgId);
const runsByClient = new Map();
for (const r of runs ?? []) {
  if (!runsByClient.has(r.client_id)) runsByClient.set(r.client_id, []);
  runsByClient.get(r.client_id).push(r);
}

function emptyArr(v) { return !Array.isArray(v) || v.length === 0; }
function emptyStr(v) { return !v || String(v).trim() === ""; }

const FIELDS = [
  ["industry", "str"], ["entity_type", "str"], ["trade_license", "str"], ["vat_trn", "str"],
  ["owner_name", "str"], ["email", "str"], ["phone", "str"], ["business_description", "str"],
  ["pain_points", "arr"], ["revenue_channels", "arr"], ["bank_names", "arr"],
  ["payment_gateways", "arr"], ["accounting_software", "arr"], ["vat_registered", "bool"],
  ["ct_registered", "bool"], ["services", "arr"], ["revenue_bracket", "str"],
  ["assigned_am", "str"],
];
function missingFields(c) {
  const m = [];
  for (const [f, t] of FIELDS) {
    if (!clientCols.has(f)) continue;
    if (t === "str" && emptyStr(c[f])) m.push(f);
    else if (t === "arr" && emptyArr(c[f])) m.push(f);
    else if (t === "bool" && (c[f] === null || c[f] === undefined)) m.push(f);
  }
  return m;
}

console.log(`Org: ${org.name}  |  Clients: ${clients.length}  |  Columns scanned: ${selCli.split(",").length}\n`);
const report = [];
for (const c of clients) {
  const miss = missingFields(c);
  const rs = runsByClient.get(c.id) ?? [];
  report.push({
    name: c.name,
    industry: c.industry ?? "-",
    am: c.assigned_am ?? rs[0]?.assigned_am ?? "-",
    runs: rs.length,
    fathom: c.call_link ? "Y" : "-",
    notes: c.call_notes && c.call_notes.length > 50 ? `${Math.round(c.call_notes.length/1000)}k` : "-",
    insights: c.call_insights ? "Y" : "-",
    desc: c.business_description ? "Y" : "-",
    miss: miss.length,
  });
}
console.table(report);

const summary = {
  total: clients.length,
  withFathomLink: clients.filter((c) => c.call_link).length,
  withNotes: clients.filter((c) => c.call_notes && c.call_notes.length > 50).length,
  withInsights: clients.filter((c) => c.call_insights).length,
  withIndustry: clients.filter((c) => c.industry).length,
  withAm: clients.filter((c) => c.assigned_am).length,
  withDescription: clients.filter((c) => c.business_description).length,
  withRunTeam: clients.filter((c) => runsByClient.get(c.id)?.some((r) => r.assigned_am || r.am_member_id)).length,
};
console.log("\nSUMMARY:", summary);

const fieldCounts = new Map();
for (const c of clients) for (const f of missingFields(c)) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
console.log("\nMOST-MISSING FIELDS:");
for (const [f, n] of [...fieldCounts.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${f.padEnd(22)} ${n}/${clients.length}`);
}

// Dump per-client detail for the ones with the most gaps
console.log("\nFULL DETAIL PER CLIENT:");
for (const c of clients) {
  const miss = missingFields(c);
  console.log(`\n- ${c.name} [${c.id.slice(0,8)}]`);
  console.log(`  industry=${c.industry ?? "-"}  entity=${c.entity_type ?? "-"}  status=${c.status ?? "-"}  group=${c.group_id ? "Y":"-"}`);
  console.log(`  trade_license=${c.trade_license ?? "-"}  vat_trn=${c.vat_trn ?? "-"}  vat_reg=${c.vat_registered ?? "-"}  ct_reg=${c.ct_registered ?? "-"}`);
  console.log(`  owner=${c.owner_name ?? "-"}  email=${c.email ?? "-"}  phone=${c.phone ?? "-"}`);
  console.log(`  banks=[${(c.bank_names ?? []).join(", ")}]  gateways=[${(c.payment_gateways ?? []).join(", ")}]  sw=[${(c.accounting_software ?? []).join(", ")}]`);
  console.log(`  rev_ch=[${(c.revenue_channels ?? []).join(", ")}]  services=[${(c.services ?? []).join(", ")}]  revenue_bracket=${c.revenue_bracket ?? "-"}`);
  console.log(`  call_link=${c.call_link ? "Y" : "-"}  notes_chars=${c.call_notes?.length ?? 0}  insights=${c.call_insights ? "Y":"-"}`);
  console.log(`  am=${c.assigned_am ?? "-"}  runs=${runsByClient.get(c.id)?.length ?? 0}`);
  console.log(`  missing(${miss.length}): ${miss.join(", ")}`);
}
