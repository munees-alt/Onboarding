// Match the configured label to the actual Gmail label (which has the typo
// "Cadeance Onboarding"). Either rename the Gmail label or sync the config —
// this script does the config side so it works immediately.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("update lead_sync_config set gmail_label = 'Cadeance Onboarding' where gmail_label <> 'Cadeance Onboarding' returning org_id, gmail_label");
console.log("Updated:", r.rows);
await c.end();
