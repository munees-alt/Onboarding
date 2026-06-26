import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

const BOT_SCOPES = ["chat:write", "chat:write.public", "channels:read", "groups:read", "users:read", "files:write"];

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session?.profile.org_id) return NextResponse.redirect(`${base}/login`);
  if (!session.profile.team_member_id) return NextResponse.redirect(`${base}/settings?slack=nomember`);

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${base}/settings?slack=error`);

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      redirect_uri: `${base}/api/connect/slack/callback`,
    }),
  });
  const tok = (await tokenRes.json()) as {
    ok: boolean;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: { id?: string };
    scope?: string;
    error?: string;
  };
  if (!tok.ok || !tok.access_token) {
    return NextResponse.redirect(`${base}/settings?slack=error&reason=${encodeURIComponent(tok.error ?? "no_token")}`);
  }

  const admin = createAdminClient();
  await admin.from("member_connections").upsert(
    {
      org_id: session.profile.org_id,
      team_member_id: session.profile.team_member_id,
      provider: "slack",
      account_email: null,
      access_token_enc: encryptSecret(tok.access_token),
      refresh_token_enc: null,
      token_expiry: null,
      scopes: tok.scope ? tok.scope.split(",") : BOT_SCOPES,
      connected: true,
      config: {
        team_id: tok.team?.id ?? null,
        team_name: tok.team?.name ?? null,
        bot_user_id: tok.bot_user_id ?? null,
        installer_user_id: tok.authed_user?.id ?? null,
      },
    },
    { onConflict: "team_member_id,provider" },
  );

  return NextResponse.redirect(`${base}/settings?slack=connected`);
}
