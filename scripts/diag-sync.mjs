import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const cfg = await c.query("select org_id, enabled, gmail_label, mailbox_member_id, services, last_synced_at, last_result from lead_sync_config");
console.log("LEAD SYNC CONFIG:"); console.log(JSON.stringify(cfg.rows, null, 2));
const conn = await c.query(`
  select mc.team_member_id, mc.account_email, mc.connected, mc.scopes, tm.full_name
  from member_connections mc join team_members tm on tm.id = mc.team_member_id
  where mc.provider = 'google' and mc.connected = true`);
console.log("\nGOOGLE CONNECTIONS:"); console.log(JSON.stringify(conn.rows, null, 2));
const leads = await c.query("select gmail_message_id, subject, from_addr, created_at from sales_email_leads order by created_at desc limit 10");
console.log("\nSALES EMAIL LEADS LOG:"); console.log(JSON.stringify(leads.rows, null, 2));
await c.end();
