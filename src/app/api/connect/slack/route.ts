import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Starts the Slack OAuth install flow. The bot scopes here are the minimum
// needed for the in-app "send templated setup request to team" feature:
//   • chat:write / chat:write.public — post messages
//   • channels:read / groups:read — list channels for the picker
//   • users:read — list workspace members for @mention picker
//   • files:write — upload trade-license / VAT-cert attachments
const BOT_SCOPES = ["chat:write", "chat:write.public", "channels:read", "groups:read", "users:read", "files:write"];

export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${base}/login`);

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${base}/settings?slack=notconfigured`);

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", `${base}/api/connect/slack/callback`);
  url.searchParams.set("state", session.userId);
  return NextResponse.redirect(url.toString());
}
