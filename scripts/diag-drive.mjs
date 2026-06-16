// Diagnose Drive folder creation end-to-end. Run: node --env-file=.env.local scripts/diag-drive.mjs
import pg from "pg";
import crypto from "node:crypto";

function getKey() {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  if (!raw) throw new Error("CADENCE_ENCRYPTION_KEY not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("key not 32 bytes");
  return key;
}
function decryptSecret(payload) {
  const [ivb, tagb, encb] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivb, "base64"));
  d.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([d.update(Buffer.from(encb, "base64")), d.final()]).toString("utf8");
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(
  "select access_token_enc, refresh_token_enc, token_expiry, drive_root_folder_id from member_connections where provider='google' limit 1",
);
await c.end();
const row = rows[0];
console.log("has access_enc:", !!row.access_token_enc, "expiry:", row.token_expiry, "root:", row.drive_root_folder_id);

let token;
try {
  token = decryptSecret(row.access_token_enc);
  console.log("DECRYPT OK, token prefix:", token.slice(0, 12) + "...");
} catch (e) {
  console.log("DECRYPT FAILED:", e.message);
  process.exit(0);
}

// Refresh if expired
const expired = row.token_expiry ? new Date(row.token_expiry).getTime() < Date.now() + 60000 : true;
if (expired && row.refresh_token_enc) {
  console.log("token expired, refreshing...");
  const refresh = decryptSecret(row.refresh_token_enc);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const tok = await res.json();
  if (tok.access_token) { token = tok.access_token; console.log("refresh OK"); }
  else console.log("refresh FAILED:", JSON.stringify(tok));
}

// Try to create a test folder in the shared root
const rootId = row.drive_root_folder_id;
console.log("\nCreating test folder under root", rootId, "...");
const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink,parents", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "ZZ Diag Folder", mimeType: "application/vnd.google-apps.folder", parents: [rootId] }),
});
const body = await create.text();
console.log("HTTP", create.status);
console.log(body);

// Clean up if created
try {
  const j = JSON.parse(body);
  if (j.id) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${j.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    console.log("cleaned up test folder", j.id);
  }
} catch {}
