import "server-only";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret, encryptSecret } from "./crypto";

/** Returns a valid Google access token for a member, refreshing if expired. */
export async function getValidGoogleToken(teamMemberId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_connections")
    .select("access_token_enc,refresh_token_enc,token_expiry")
    .eq("team_member_id", teamMemberId)
    .eq("provider", "google")
    .maybeSingle();
  if (!data?.access_token_enc) return null;

  const expired = data.token_expiry ? new Date(data.token_expiry).getTime() < Date.now() + 60_000 : true;
  if (!expired) {
    try { return decryptSecret(data.access_token_enc); } catch { return null; }
  }
  if (!data.refresh_token_enc) {
    try { return decryptSecret(data.access_token_enc); } catch { return null; }
  }
  // Refresh.
  try {
    const refresh = decryptSecret(data.refresh_token_enc);
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
    if (!tok.access_token) return null;
    await admin.from("member_connections").update({
      access_token_enc: encryptSecret(tok.access_token),
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    }).eq("team_member_id", teamMemberId).eq("provider", "google");
    return tok.access_token;
  } catch {
    return null;
  }
}

/** Sends an email via the member's Gmail. Returns true on success. */
export async function sendGmailAs(teamMemberId: string, to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return { ok: false, error: "Connect Google in Settings first." };
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) return { ok: false, error: `Gmail error ${res.status}` };
  return { ok: true };
}
