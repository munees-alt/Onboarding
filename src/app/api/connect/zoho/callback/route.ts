import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session?.profile.org_id) return NextResponse.redirect(`${base}/login`);
  if (!session.profile.team_member_id) return NextResponse.redirect(`${base}/settings?zoho=nomember`);

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!code) return NextResponse.redirect(`${base}/settings?zoho=error`);

  const accounts = params.get("accounts-server") || process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com";
  const tokenRes = await fetch(`${accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
      redirect_uri: `${base}/api/connect/zoho/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.access_token) return NextResponse.redirect(`${base}/settings?zoho=error`);

  const admin = createAdminClient();
  await admin.from("member_connections").upsert(
    {
      org_id: session.profile.org_id,
      team_member_id: session.profile.team_member_id,
      provider: "zoho",
      access_token_enc: encryptSecret(tok.access_token),
      refresh_token_enc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      scopes: ["ZohoBooks.fullaccess.all"],
      config: { api_domain: tok.api_domain ?? null, accounts },
      connected: true,
    },
    { onConflict: "team_member_id,provider" },
  );

  return NextResponse.redirect(`${base}/settings?zoho=connected`);
}
