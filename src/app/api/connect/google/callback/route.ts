import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

const DEFAULT_DRIVE_ROOT_FOLDER_ID =
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1r-FdD4NRrMvKD4tITiY6PTglo1z_Cy4_";

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session?.profile.org_id) return NextResponse.redirect(`${base}/login`);
  if (!session.profile.team_member_id) return NextResponse.redirect(`${base}/settings?google=nomember`);

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${base}/settings?google=error`);

  // Exchange the code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${base}/api/connect/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.access_token) return NextResponse.redirect(`${base}/settings?google=error`);

  const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json()).catch(() => ({}));

  const admin = createAdminClient();
  await admin.from("member_connections").upsert(
    {
      org_id: session.profile.org_id,
      team_member_id: session.profile.team_member_id,
      provider: "google",
      account_email: ui.email ?? null,
      access_token_enc: encryptSecret(tok.access_token),
      refresh_token_enc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      scopes: SCOPES,
      drive_root_folder_id: DEFAULT_DRIVE_ROOT_FOLDER_ID,
      connected: true,
    },
    { onConflict: "team_member_id,provider" },
  );

  return NextResponse.redirect(`${base}/settings?google=connected`);
}
