import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.send",
  // gmail.readonly lets the master-admin mailbox be polled for sales "Payment Received"
  // emails → auto-created onboarding leads. Requires a one-time Google reconnect to grant.
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

// Starts the Google OAuth consent flow for the signed-in member.
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${base}/login`);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${base}/settings?google=notconfigured`);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${base}/api/connect/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", session.userId);
  return NextResponse.redirect(url.toString());
}
