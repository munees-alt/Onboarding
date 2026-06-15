import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Starts the Zoho OAuth consent flow for the signed-in member.
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${base}/login`);

  const clientId = process.env.ZOHO_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${base}/settings?zoho=notconfigured`);

  const accounts = process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.com";
  const url = new URL(`${accounts}/oauth/v2/auth`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${base}/api/connect/zoho/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "ZohoBooks.fullaccess.all");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", session.userId);
  return NextResponse.redirect(url.toString());
}
