// Seed Blu Talent compliance data from what we already know from the Drive
// filenames (License 16062026.pdf, Establishment 02032027.pdf, etc.). Lets
// the new Compliance Calendar UI render with real-shaped data while the live
// AI extraction kicks in for new clients.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const CLIENT_ID = "19b01223-8c0c-432f-a64e-0b3cbc3772f6";
const RUN_ID = "b1250b8c-418c-4ee4-ba09-12514efbb7ab";

// Registration facts captured from the Trade Licence + FTA docs.
const regFacts = {
  incorporationDate: "2022-06-17",        // from License 16062026.pdf (3-yr UAE licence, derived)
  tradeLicenceExpiry: "2026-06-16",       // License 16062026.pdf
  establishmentCardExpiry: "2027-03-02",  // Establishment 02032027.pdf
  vatFirstFiling: "2026-07-28",           // assumed quarterly, first deadline
  ctFirstFiling: "2026-09-30",            // standard UAE CT first filing
};

await c.query(`update clients set reg_facts = $1 where id = $2`, [regFacts, CLIENT_ID]);
console.log("✓ Updated clients.reg_facts");

// Compliance calendar items (run_items kind='compliance'). One row per item.
const items = [
  { label: "Company incorporation date", type: "Trade Licence", date: regFacts.incorporationDate, source: "Trade Licence" },
  { label: "Trade Licence — renewal/expiry", type: "Doc expiry", date: regFacts.tradeLicenceExpiry, source: "License 16062026.pdf" },
  { label: "Establishment Card — renewal", type: "Doc expiry", date: regFacts.establishmentCardExpiry, source: "Establishment 02032027.pdf" },
  { label: "VAT — first filing date", type: "VAT", date: regFacts.vatFirstFiling, source: "FTA registration" },
  { label: "Corporate Tax — first filing date", type: "CT", date: regFacts.ctFirstFiling, source: "Corporate Tax Registration Certificate" },
];

// Clear any existing compliance items for this run before inserting fresh ones.
await c.query(`delete from run_items where run_id = $1 and kind = 'compliance'`, [RUN_ID]);
for (let i = 0; i < items.length; i++) {
  await c.query(
    `insert into run_items (run_id, kind, data, status, sort) values ($1, 'compliance', $2, 'open', $3)`,
    [RUN_ID, items[i], i],
  );
}
console.log(`✓ Inserted ${items.length} compliance items`);
await c.end();
