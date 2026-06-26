import "server-only";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret, encryptSecret } from "./crypto";

// Zoho Books API helpers — token refresh + Chart-of-Accounts create.
// Tokens live in member_connections (provider='zoho'); api_domain + accounts URL
// are stored in config from the OAuth callback.

interface ZohoConn {
  team_member_id: string;
  org_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
  api_domain: string;
  accounts: string;
}

async function loadZohoConn(orgId: string, preferTeamMemberId?: string | null): Promise<ZohoConn | null> {
  const admin = createAdminClient();
  let query = admin
    .from("member_connections")
    .select("team_member_id,org_id,access_token_enc,refresh_token_enc,token_expiry,config,connected")
    .eq("provider", "zoho")
    .eq("connected", true)
    .eq("org_id", orgId);
  if (preferTeamMemberId) query = query.eq("team_member_id", preferTeamMemberId);
  const { data } = await query.limit(1).maybeSingle();
  const row = data ?? (preferTeamMemberId
    ? (await admin.from("member_connections").select("team_member_id,org_id,access_token_enc,refresh_token_enc,token_expiry,config,connected").eq("provider", "zoho").eq("connected", true).eq("org_id", orgId).limit(1).maybeSingle()).data
    : null);
  if (!row || !row.access_token_enc) return null;
  const cfg = (row.config ?? {}) as { api_domain?: string; accounts?: string };
  return {
    team_member_id: row.team_member_id as string,
    org_id: row.org_id as string,
    access_token: decryptSecret(row.access_token_enc as string),
    refresh_token: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc as string) : null,
    token_expiry: row.token_expiry as string | null,
    api_domain: cfg.api_domain || "https://www.zohoapis.com",
    accounts: cfg.accounts || process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
  };
}

async function refreshIfNeeded(conn: ZohoConn): Promise<ZohoConn> {
  const exp = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (exp - Date.now() > 60_000) return conn;  // > 1min remaining — reuse
  if (!conn.refresh_token) throw new Error("Zoho token expired and no refresh token on file — reconnect Zoho.");
  const url = `${conn.accounts}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: conn.refresh_token,
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  const r = await fetch(url, { method: "POST", body });
  const tok = await r.json();
  if (!r.ok || !tok.access_token) throw new Error(`Zoho token refresh failed: ${tok.error ?? r.status}`);
  const admin = createAdminClient();
  await admin
    .from("member_connections")
    .update({
      access_token_enc: encryptSecret(tok.access_token),
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    })
    .eq("team_member_id", conn.team_member_id)
    .eq("provider", "zoho");
  return { ...conn, access_token: tok.access_token };
}

async function zohoFetch(conn: ZohoConn, path: string, init?: RequestInit & { searchParams?: Record<string, string> }) {
  const c = await refreshIfNeeded(conn);
  const url = new URL(`${c.api_domain}${path}`);
  for (const [k, v] of Object.entries(init?.searchParams ?? {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${c.access_token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await r.text();
  let json: unknown = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* leave null */ }
  if (!r.ok) {
    const msg = (json && typeof json === "object" && "message" in json) ? String((json as { message: string }).message) : `HTTP ${r.status}`;
    throw new Error(`Zoho ${r.status}: ${msg}`);
  }
  return json as Record<string, unknown>;
}

async function pickOrganizationId(conn: ZohoConn, preferred?: string | null): Promise<string> {
  const res = await zohoFetch(conn, "/books/v3/organizations");
  const orgs = (res.organizations ?? []) as Array<{ organization_id: string; name: string }>;
  if (!orgs.length) throw new Error("No Zoho Books organizations linked to this user.");
  if (preferred) {
    const m = orgs.find((o) => o.organization_id === preferred || o.name === preferred);
    if (m) return m.organization_id;
  }
  return orgs[0].organization_id;
}

type CoaSection = "Revenue" | "Cost of Goods Sold" | "Other Income" | "Operating Expense" | "Expense" | "Asset" | "Liability" | "Equity";
const SECTION_TO_ZOHO: Record<string, string> = {
  "revenue": "income",
  "other income": "income",
  "cost of goods sold": "cost_of_goods_sold",
  "operating expense": "expense",
  "expense": "expense",
  "asset": "other_asset",
  "liability": "other_liability",
  "equity": "equity",
};

export interface CoaLineToPush {
  code: string;
  account: string;
  section: CoaSection | string;
  description?: string;
}

/**
 * Push every COA line to the Zoho Books org connected by `pushedBy` (or any
 * org-level Zoho user as fallback). Returns counts + per-line errors.
 *
 * Skips lines whose `code` already exists in Zoho (Zoho rejects duplicate
 * codes). Failures don't abort — they're collected and returned.
 */
export async function pushCoaToZohoBooks(args: {
  orgId: string;
  pushedByTeamMemberId?: string | null;
  lines: CoaLineToPush[];
  zohoOrganizationId?: string | null;
}): Promise<{
  created: number;
  skipped: number;
  failed: number;
  zohoOrganizationId: string;
  errors: Array<{ code: string; account: string; reason: string }>;
}> {
  const conn = await loadZohoConn(args.orgId, args.pushedByTeamMemberId);
  if (!conn) throw new Error("No Zoho-connected user in this org — connect Zoho Books in My Connections first.");
  const orgIdZoho = await pickOrganizationId(conn, args.zohoOrganizationId);

  // Pull existing chart so we don't duplicate.
  const existing = await zohoFetch(conn, "/books/v3/chartofaccounts", { searchParams: { organization_id: orgIdZoho } });
  const existingCodes = new Set(
    ((existing.chartofaccounts ?? []) as Array<{ account_code?: string; account_name?: string }>)
      .map((a) => (a.account_code ?? "").trim())
      .filter(Boolean),
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ code: string; account: string; reason: string }> = [];

  for (const line of args.lines) {
    const code = (line.code ?? "").trim();
    const name = (line.account ?? "").replace(/^\d+\s*[:\-—]\s*/, "").trim();
    if (!name) { failed++; errors.push({ code, account: line.account, reason: "blank account name" }); continue; }
    if (code && existingCodes.has(code)) { skipped++; continue; }
    const accountType = SECTION_TO_ZOHO[(line.section ?? "").toLowerCase()] ?? "expense";
    try {
      await zohoFetch(conn, "/books/v3/chartofaccounts", {
        method: "POST",
        searchParams: { organization_id: orgIdZoho },
        body: JSON.stringify({
          account_name: name,
          account_type: accountType,
          account_code: code || undefined,
          description: line.description ?? undefined,
        }),
      });
      created++;
      if (code) existingCodes.add(code);
    } catch (e) {
      failed++;
      errors.push({ code, account: name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return { created, skipped, failed, zohoOrganizationId: orgIdZoho, errors };
}
