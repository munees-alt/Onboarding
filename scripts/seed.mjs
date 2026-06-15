// Seed reference data: org, COA templates, org chart, onboarding personas, settings.
// Idempotent. Run: node --env-file=.env.local scripts/seed.mjs
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real Finanshels org chart (from the prototype's org-seed.js).
const ORG_SEED = {"name":"Mohammed Shafeekh","role":"CEO","location":"Dubai","dept":"Management","children":[{"name":"Anas CP","role":"Admin Cum Driver","location":"Dubai","dept":"Office Admin & IT","children":[]},{"name":"Arfa Khalid","role":"Partnership Executive","location":"Dubai","dept":"Partnerships","children":[]},{"name":"Ashish Yadav","role":"Team Lead","location":"Dubai","dept":"Sales","children":[{"name":"Ekta Jha","role":"Associate – Client Relations","location":"Dubai","dept":"Sales","children":[]},{"name":"Hira Asghar","role":"Associate – Client Relations","location":"Dubai","dept":"Sales","children":[]}]},{"name":"Ashish Tripathi","role":"Head of Monetization & Product","location":"Remote","dept":"Engineering","children":[]},{"name":"Brijen Brahmbhatt","role":"Manager – Talent Acquisition","location":"Remote","dept":"HR & TA","children":[]},{"name":"Emil Rizwan Channanath","role":"Customer Success Manager","location":"Dubai","dept":"Customer Success","children":[]},{"name":"Meet Patel","role":"AVP Business Excellence","location":"Dubai","dept":"Centre of Excellence","children":[]},{"name":"Muhammd Musthafa","role":"—","location":"Dubai","dept":"Management","children":[]},{"name":"Rahul Kohli","role":"Head of Marketing","location":"Dubai","dept":"Marketing","children":[]},{"name":"Rowena Pamesa","role":"Executive Assistant","location":"Remote – Dubai","dept":"Centre of Excellence","children":[]},{"name":"Santo","role":"Assistant Manager – Organization","location":"Dubai","dept":"COE – Founders Office","children":[]},{"name":"Suhail Kanjirathparambil","role":"Head of Finance Operations","location":"Dubai","dept":"Finance Operations","children":[{"name":"Jaydeep Khamkar","role":"Head – Medium Team FinOps","location":"Dubai","dept":"FinOps – Medium","children":[{"name":"Darshit Lodaya","role":"Financial Controller","location":"Remote","dept":"FinOps – Medium","children":[{"name":"Ankit Dey","role":"Senior Team Lead","location":"Remote","dept":"FinOps – Medium","children":[{"name":"Muhammed Nihal","role":"Senior Accounting Advisor II","location":"Calicut","dept":"FinOps – Medium","children":[{"name":"Vishakha Mittal","role":"Accounting Advisor II","location":"Remote","dept":"FinOps – Medium","children":[]},{"name":"Anantha BS","role":"Accounting Advisor I","location":"Remote","dept":"FinOps – Medium","children":[]}]},{"name":"Mohammed Sinan E","role":"Senior Accounting Advisor II","location":"Calicut","dept":"FinOps – Medium","children":[{"name":"Aakarsh R","role":"Accounting Advisor I","location":"Calicut","dept":"FinOps – Medium","children":[]},{"name":"Nisin C","role":"Finance Intern","location":"Calicut","dept":"FinOps – Medium","children":[]},{"name":"Muhammed Rishal","role":"Finance Intern","location":"Calicut","dept":"FinOps – Medium","children":[]}]},{"name":"Tina Patidar","role":"Senior Accounting Advisor II","location":"Remote","dept":"FinOps – Medium","children":[{"name":"Kiran Sebastian","role":"Finance Intern","location":"Remote","dept":"FinOps – Medium","children":[]}]}]}]},{"name":"Mohit Sharma","role":"Financial Controller","location":"Remote","dept":"FinOps – Medium","children":[{"name":"Elizabath Juliet","role":"Senior Accounting Advisor","location":"Calicut","dept":"FinOps – Medium","children":[{"name":"Muhammed Shamil","role":"Accounting Advisor 1","location":"India","dept":"FinOps – Medium","children":[]}]},{"name":"Shrooti Sharma","role":"Team Lead","location":"India","dept":"FinOps – Medium","children":[{"name":"Soham Rajhans","role":"Accounting Advisor I","location":"India","dept":"FinOps – Medium","children":[]},{"name":"Kirti Manoj Patel","role":"Senior Accounting Advisor","location":"India","dept":"FinOps – Medium","children":[]},{"name":"Saloni Badiyani","role":"Accounting Advisor I","location":"India","dept":"FinOps – Medium","children":[]},{"name":"Jyoti Patil","role":"Senior Associate Accounting","location":"India","dept":"FinOps – Medium","children":[]},{"name":"Naja Akmal","role":"Finance Intern","location":"India","dept":"FinOps – Medium","children":[]}]}]}]},{"name":"Gautam Sanoj","role":"Head – Tax Team","location":"Dubai","dept":"Tax","children":[{"name":"Abdul Afeef","role":"Senior Tax Advisor – SPC","location":"","dept":"Tax – SPC","children":[{"name":"Amal Ganesh","role":"Tax Advisor","location":"","dept":"Tax – SPC","children":[]},{"name":"Sruthy K","role":"Tax Advisor","location":"","dept":"Tax – SPC","children":[]},{"name":"Jyolsana","role":"Intern","location":"","dept":"Tax – SPC","children":[]},{"name":"M Hafis","role":"Intern","location":"","dept":"Tax – SPC","children":[]},{"name":"Akash Jaiswal","role":"Intern","location":"","dept":"Tax – SPC","children":[]},{"name":"Manav W","role":"Coordinator","location":"","dept":"Tax – SPC","children":[]}]},{"name":"Nafila A R","role":"Team Lead – External Tax","location":"Remote","dept":"Tax – External","children":[{"name":"Shamna","role":"Senior Tax Advisor","location":"","dept":"Tax – External","children":[]},{"name":"Moonisa F","role":"Tax Advisor","location":"","dept":"Tax – External","children":[]},{"name":"Shrusti P","role":"Tax Advisor","location":"","dept":"Tax – External","children":[]},{"name":"Shada B","role":"Associate","location":"","dept":"Tax – External","children":[]},{"name":"Shazla","role":"Intern","location":"","dept":"Tax – External","children":[]},{"name":"Arshiya","role":"Intern","location":"","dept":"Tax – External","children":[]},{"name":"Fathima Hiba","role":"Intern","location":"","dept":"Tax – External","children":[]},{"name":"Jerlin","role":"Coordinator","location":"","dept":"Tax – External","children":[]}]},{"name":"Aarju K","role":"Team Lead – ALC","location":"","dept":"FinOps – ALC","children":[{"name":"Neeraja","role":"Accounting Advisor","location":"","dept":"FinOps – ALC","children":[]},{"name":"Preity","role":"Accounting Advisor","location":"","dept":"FinOps – ALC","children":[]},{"name":"Arya A","role":"Audit & Liquidation Advisor","location":"","dept":"FinOps – ALC","children":[]},{"name":"Ridhul","role":"Intern","location":"","dept":"FinOps – ALC","children":[]}]}]},{"name":"Jasmeet Singh Monga","role":"Head – Micro Team FinOps A","location":"Remote","dept":"FinOps – Micro A","children":[{"name":"Hitesh","role":"Team Lead – Pod A","location":"","dept":"FinOps – Micro A","children":[{"name":"Konduru","role":"Senior – Pod A1","location":"","dept":"FinOps – Micro A","children":[{"name":"Sajal","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Bijin","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Sisina","role":"Intern","location":"","dept":"FinOps – Micro A","children":[]}]},{"name":"Nahan","role":"Senior – Pod A2","location":"","dept":"FinOps – Micro A","children":[{"name":"Rakavi","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Aryanandana","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Aryamol","role":"Intern","location":"","dept":"FinOps – Micro A","children":[]}]}]},{"name":"Mukesh","role":"Team Lead – Pod B","location":"","dept":"FinOps – Micro A","children":[{"name":"Hritheesh","role":"Senior – Pod B1","location":"","dept":"FinOps – Micro A","children":[{"name":"Muskan","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Aleena Cyriac","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Nadir","role":"Intern","location":"","dept":"FinOps – Micro A","children":[]}]},{"name":"Prateeksha","role":"Senior – Pod B2","location":"","dept":"FinOps – Micro A","children":[{"name":"Mubajjil","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Gopika","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Hajra","role":"Intern","location":"","dept":"FinOps – Micro A","children":[]}]}]},{"name":"Syed","role":"Team Lead – Pod C","location":"","dept":"FinOps – Micro A","children":[{"name":"Shahil","role":"Senior – Pod C1","location":"","dept":"FinOps – Micro A","children":[{"name":"Anand","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Lamiya","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Amal John","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]}]},{"name":"Senior – Pod C2 (TBD)","role":"Senior – not yet decided","location":"","dept":"FinOps – Micro A","children":[{"name":"Nafla","role":"Advisor","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Suvetha","role":"Associate","location":"","dept":"FinOps – Micro A","children":[]},{"name":"Samiksha","role":"Intern","location":"","dept":"FinOps – Micro A","children":[]}]}]}]},{"name":"Akshay Sanjay Kadam","role":"Head – Micro Team FinOps B","location":"Remote","dept":"FinOps – Micro B","children":[{"name":"Anuj","role":"Team lead","location":"","dept":"FinOps – Micro B","children":[{"name":"Maitali","role":"Senior Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Divya","role":"Junior Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Aleena","role":"Associate Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Rupali","role":"Senior Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Shalini","role":"Junior Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Arjun","role":"Associate Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]}]},{"name":"Bhagyalakshmi","role":"Team lead","location":"","dept":"FinOps – Micro B","children":[{"name":"Zalek","role":"Senior Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]},{"name":"Ajnas","role":"Associate Accounting Advisor","location":"","dept":"FinOps – Micro B","children":[]}]}]},{"name":"Munees KV","role":"Lead Accounting Advisor","location":"Dubai","dept":"Onboarding","children":[]},{"name":"Krishna Subash Nair","role":"Head – AML Team","location":"Remote – Dubai","dept":"AML & Compliance","children":[]},{"name":"Devanshi Panchal","role":"Senior Accounting Advisor – Annual Team","location":"","dept":"FinOps – Annual","children":[{"name":"Anita Kumawat","role":"Accounting Advisor","location":"","dept":"FinOps – Annual","children":[]},{"name":"Ashish Agarwal","role":"Accounting Advisor","location":"","dept":"FinOps – Annual","children":[]},{"name":"Hiba Sherin","role":"Intern","location":"","dept":"FinOps – Annual","children":[]}]}]},{"name":"Vishal Dilip Singh","role":"Team Lead – Partnership Management","location":"Dubai","dept":"Partnerships","children":[]}]};

const AVATAR_COLORS = ["#f97316","#2563eb","#16a34a","#7c3aed","#0d9488","#d97706","#dc2626"];

function bucket(role) {
  const r = (role || "").toLowerCase();
  if (/ceo|chief executive/.test(r)) return "admin";
  if (/head of finance operations/.test(r)) return "ops_head";
  if (/\bhead\b/.test(r)) return "am";
  if (/intern/.test(r)) return "intern";
  if (/associate/.test(r)) return "associate";
  if (/senior|controller/.test(r)) return "senior"; // Senior Accountant, Senior Team Lead
  if (/team lead|\blead\b/.test(r)) return "team_lead"; // Team Lead, Lead
  if (/advisor|accountant|coordinator/.test(r)) return "junior";
  return "other";
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`✗ ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const db = await connect();

// 1) Org (idempotent — orgs has no unique constraint on name, so select first)
const existingOrg = (await db.query(`select id from orgs order by created_at asc limit 1`)).rows[0];
const orgId = existingOrg
  ? existingOrg.id
  : (await db.query(`insert into orgs (name) values ('Finanshels') returning id`)).rows[0].id;
console.log("Org:", orgId);

// 2) COA templates
const coa = JSON.parse(await readFile(path.join(__dirname, "..", "src", "lib", "coa-templates.json"), "utf8"));
let coaCount = 0;
for (const [industry, accounts] of Object.entries(coa)) {
  await db.query(
    `insert into coa_templates (industry, accounts) values ($1, $2)
     on conflict (industry) do update set accounts = excluded.accounts`,
    [industry, JSON.stringify(accounts)],
  );
  coaCount++;
}
console.log(`COA templates: ${coaCount}`);

// 3) Org chart → team_members (recursive, with reports_to)
let tmCount = 0, ci = 0;
async function insertNode(node, parentId) {
  const role = node.name === "Munees KV" ? "admin" : bucket(node.role);
  const email = node.name === "Munees KV" ? "munees@finanshels.com" : null;
  const existing = (await db.query(
    `select id from team_members where org_id=$1 and full_name=$2 and is_demo=false limit 1`,
    [orgId, node.name],
  )).rows[0];
  let id;
  if (existing) {
    id = existing.id;
    await db.query(
      `update team_members set role=$1, title=$2, dept=$3, location=$4, reports_to=$5, email=coalesce($6,email) where id=$7`,
      [role, node.role, node.dept, node.location, parentId, email, id],
    );
  } else {
    id = (await db.query(
      `insert into team_members (org_id, full_name, email, role, title, dept, location, reports_to, avatar_initials, avatar_color, is_demo, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11) returning id`,
      [orgId, node.name, email, role, node.role, node.dept, node.location, parentId,
       initials(node.name), AVATAR_COLORS[ci++ % AVATAR_COLORS.length], tmCount],
    )).rows[0].id;
  }
  tmCount++;
  for (const child of node.children || []) await insertNode(child, id);
  return id;
}
await insertNode(ORG_SEED, null);
console.log(`Org chart members: ${tmCount}`);

// 4) (Demo personas intentionally not seeded — real org-chart people only.)

// 5) Empty settings rows
await db.query(`insert into ai_settings (org_id) values ($1) on conflict (org_id) do nothing`, [orgId]);
await db.query(`insert into integration_settings (org_id) values ($1) on conflict (org_id) do nothing`, [orgId]);
console.log("Settings rows ready.");

await db.end();
console.log("\n✓ Seed complete.");
