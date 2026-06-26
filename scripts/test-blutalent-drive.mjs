// Confirms the compliance fix: with the new fallback to ANY Google-connected
// org member, Munees's token reads Blu Talent's Drive folder and returns docs.
// Mirrors what listDriveDocsByFolderId() now does inside generateComplianceFromDocs.
import pg from "pg";
import crypto from "crypto";

function decryptSecret(payload) {
  // Mirrors src/lib/crypto.ts: "iv:tag:ciphertext" all base64.
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const [ivb, tagb, encb] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivb, "base64"));
  d.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([d.update(Buffer.from(encb, "base64")), d.final()]).toString("utf8");
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`
  select tm.full_name, mc.refresh_token_enc, mc.account_email, mc.scopes
  from member_connections mc join team_members tm on tm.id = mc.team_member_id
  where mc.provider = 'google' and mc.connected = true and tm.org_id = '2afd6f11-b546-4860-a09d-090fa3952367'
  order by case when tm.role = 'admin' then 0 else 1 end
  limit 1`);
await c.end();

if (!rows.length) { console.log("No google-connected member in org"); process.exit(1); }
const member = rows[0];
console.log("Falling back to:", member.full_name, "·", member.account_email);
console.log("Scopes:", member.scopes);

const refreshToken = decryptSecret(member.refresh_token_enc);
const tok = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
if (!tok.ok) { console.error("Token refresh failed:", await tok.text()); process.exit(1); }
const accessToken = (await tok.json()).access_token;

// Find the Company Documents subfolder under Blu Talent's folder, then list files.
const BLU = "1YpiRa_S7Aauh9Nj9CCBJxqot4pb73c7f";
const sub = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${BLU}' in parents and trashed=false`)}&fields=files(id,name,mimeType)`,
  { headers: { Authorization: `Bearer ${accessToken}` } });
const subJ = await sub.json();
const companyDocs = subJ.files?.find(f => /company\s*documents/i.test(f.name));
console.log("\nTop-level folders:", subJ.files?.map(f => f.name).join(", "));
if (!companyDocs) { console.log("No 'Company Documents' subfolder."); process.exit(0); }

async function listAll(parentId, depth, prefix) {
  if (depth > 3) return [];
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}&fields=files(id,name,mimeType,size)&pageSize=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  const all = [];
  for (const f of (j.files ?? [])) {
    if (f.mimeType === "application/vnd.google-apps.folder") {
      console.log(`${prefix}📁 ${f.name}/`);
      all.push(...await listAll(f.id, depth + 1, prefix + "  "));
    } else {
      console.log(`${prefix}📄 ${f.name}  [${f.mimeType}]${f.size ? ` ${(f.size/1024).toFixed(1)}KB` : ""}`);
      all.push(f);
    }
  }
  return all;
}
const allFiles = await listAll(companyDocs.id, 0, "  ");
console.log(`\nTOTAL READABLE FILES under Company Documents: ${allFiles.length}`);

