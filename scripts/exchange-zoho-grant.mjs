// One-shot: exchange a Zoho OAuth grant code for access/refresh tokens and
// store them encrypted in member_connections for Munees. Run within 10 min of
// generating the grant code (they expire fast).
//
//   node --env-file=.env.local scripts/exchange-zoho-grant.mjs <GRANT_CODE>

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const grant = process.argv[2];
if (!grant) { console.error("Usage: node scripts/exchange-zoho-grant.mjs <grant_code>"); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function encrypt(plain) {
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

const accounts = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com";
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Try BOTH paths: server-based-app (with redirect_uri) AND self-client (without).
// Whichever Zoho accepts wins.
async function exchange(includeRedirect) {
  const body = new URLSearchParams({
    code: grant,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: "authorization_code",
  });
  if (includeRedirect) body.set("redirect_uri", `${base}/api/connect/zoho/callback`);
  const res = await fetch(`${accounts}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await res.json();
  return { ok: !!j.access_token, j };
}

let result = await exchange(true);
console.log("server-based-app exchange:", result.ok ? "ok" : "fail", result.ok ? "" : JSON.stringify(result.j));
if (!result.ok) {
  result = await exchange(false);
  console.log("self-client exchange:    ", result.ok ? "ok" : "fail", result.ok ? "" : JSON.stringify(result.j));
}
if (!result.ok) {
  console.error("\nBoth exchanges failed. Likely causes:");
  console.error("  • grant code expired (re-generate in api-console.zoho.com)");
  console.error("  • client_id / secret don't match the app that issued the code");
  console.error("  • wrong data centre — change ZOHO_ACCOUNTS_DOMAIN to .eu/.in/.ae if your Zoho org isn't on .com");
  process.exit(1);
}

const tok = result.j;
console.log("\nGot tokens:");
console.log("  access_token expires in:", tok.expires_in, "sec");
console.log("  refresh_token present:  ", !!tok.refresh_token);
console.log("  api_domain:             ", tok.api_domain);

// Find Munees's profile → team_member + org.
const { data: org } = await db.from("orgs").select("id").limit(1).single();
const { data: mun } = await db.from("team_members").select("id").eq("org_id", org.id).ilike("full_name", "Munees%").limit(1).single();

const row = {
  org_id: org.id,
  team_member_id: mun.id,
  provider: "zoho",
  access_token_enc: encrypt(tok.access_token),
  refresh_token_enc: tok.refresh_token ? encrypt(tok.refresh_token) : null,
  token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  scopes: ["ZohoBooks.fullaccess.all"],
  config: { api_domain: tok.api_domain ?? null, accounts },
  connected: true,
};
const { error } = await db.from("member_connections").upsert(row, { onConflict: "team_member_id,provider" });
if (error) { console.error("DB upsert failed:", error.message); process.exit(1); }

// Verify by hitting a benign Zoho Books endpoint.
const apiDomain = tok.api_domain || "https://www.zohoapis.com";
const ping = await fetch(`${apiDomain}/books/v3/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${tok.access_token}` } });
const pj = await ping.json().catch(() => ({}));
console.log("\nZoho Books ping:", ping.status, pj.organizations ? `· ${pj.organizations.length} org(s) accessible` : JSON.stringify(pj).slice(0, 200));
console.log("\n✓ Stored. Refresh button on the Settings → Zoho card will say 'Zoho Books connected'.");
