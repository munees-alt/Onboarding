import "server-only";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";

// The bot token is installed once per workspace; any org member uses it via
// this helper. Stored encrypted in member_connections (provider='slack') on
// the member who completed the OAuth.
export async function getOrgSlackToken(orgId: string): Promise<{ token: string; teamName: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_connections")
    .select("access_token_enc,config")
    .eq("provider", "slack")
    .eq("connected", true)
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.access_token_enc) return null;
  try {
    const token = decryptSecret(data.access_token_enc);
    const cfg = (data.config ?? {}) as { team_name?: string };
    return { token, teamName: cfg.team_name ?? null };
  } catch {
    return null;
  }
}

type SlackChannel = { id: string; name: string; is_private: boolean; is_archived: boolean; num_members?: number };
type SlackUser = { id: string; name: string; real_name?: string; profile?: { real_name?: string; display_name?: string; email?: string; image_24?: string }; deleted?: boolean; is_bot?: boolean };

export async function listSlackChannels(orgId: string): Promise<SlackChannel[]> {
  const t = await getOrgSlackToken(orgId);
  if (!t) return [];
  const out: SlackChannel[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("exclude_archived", "true");
    url.searchParams.set("limit", "200");
    url.searchParams.set("types", "public_channel,private_channel");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { authorization: `Bearer ${t.token}` } });
    const j = (await res.json()) as { ok: boolean; channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } };
    if (!j.ok) break;
    out.push(...(j.channels ?? []));
    cursor = j.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out.filter((c) => !c.is_archived);
}

export async function listSlackUsers(orgId: string): Promise<SlackUser[]> {
  const t = await getOrgSlackToken(orgId);
  if (!t) return [];
  const out: SlackUser[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const url = new URL("https://slack.com/api/users.list");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { authorization: `Bearer ${t.token}` } });
    const j = (await res.json()) as { ok: boolean; members?: SlackUser[]; response_metadata?: { next_cursor?: string } };
    if (!j.ok) break;
    out.push(...(j.members ?? []));
    cursor = j.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out.filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT");
}

export async function postSlackMessage(orgId: string, input: { channel: string; text: string; mentions?: string[] }): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const t = await getOrgSlackToken(orgId);
  if (!t) return { ok: false, error: "slack_not_connected" };
  const mentionText = (input.mentions ?? []).map((id) => `<@${id}>`).join(" ");
  const body = mentionText ? `${mentionText}\n${input.text}` : input.text;
  // Resolve channel: accept either an id (C…/G…) or a name (with or without #).
  let channelId = input.channel;
  if (!/^[CG][A-Z0-9]+$/.test(channelId)) {
    const name = channelId.replace(/^#/, "").trim().toLowerCase();
    const channels = await listSlackChannels(orgId);
    const hit = channels.find((c) => c.name.toLowerCase() === name);
    if (!hit) return { ok: false, error: "channel_not_found" };
    channelId = hit.id;
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${t.token}` },
    body: JSON.stringify({ channel: channelId, text: body, unfurl_links: false, unfurl_media: false }),
  });
  const j = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  return j.ok ? { ok: true, ts: j.ts } : { ok: false, error: j.error };
}

// Uploads a file from a public URL (e.g. a Supabase Storage signed link or a
// Drive view link). Slack's files.upload requires multipart, so we fetch the
// bytes here and forward them. Returns the file id.
export async function uploadSlackFile(orgId: string, input: { channel: string; fileUrl: string; filename: string; title?: string }): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const t = await getOrgSlackToken(orgId);
  if (!t) return { ok: false, error: "slack_not_connected" };
  const bytes = await fetch(input.fileUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (!bytes) return { ok: false, error: "file_fetch_failed" };

  // Slack's modern flow: files.getUploadURLExternal → PUT → files.completeUploadExternal.
  const getUrl = new URL("https://slack.com/api/files.getUploadURLExternal");
  getUrl.searchParams.set("filename", input.filename);
  getUrl.searchParams.set("length", String(bytes.byteLength));
  const getRes = await fetch(getUrl, { headers: { authorization: `Bearer ${t.token}` } });
  const getJ = (await getRes.json()) as { ok: boolean; upload_url?: string; file_id?: string; error?: string };
  if (!getJ.ok || !getJ.upload_url || !getJ.file_id) return { ok: false, error: getJ.error || "getUploadURL_failed" };

  const putRes = await fetch(getJ.upload_url, { method: "POST", body: Buffer.from(bytes) });
  if (!putRes.ok) return { ok: false, error: "upload_put_failed" };

  // Resolve channel id (same logic as postSlackMessage).
  let channelId = input.channel;
  if (!/^[CG][A-Z0-9]+$/.test(channelId)) {
    const name = channelId.replace(/^#/, "").trim().toLowerCase();
    const channels = await listSlackChannels(orgId);
    const hit = channels.find((c) => c.name.toLowerCase() === name);
    if (!hit) return { ok: false, error: "channel_not_found" };
    channelId = hit.id;
  }

  const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${t.token}` },
    body: JSON.stringify({
      files: [{ id: getJ.file_id, title: input.title ?? input.filename }],
      channel_id: channelId,
    }),
  });
  const completeJ = (await completeRes.json()) as { ok: boolean; error?: string };
  return completeJ.ok ? { ok: true, fileId: getJ.file_id } : { ok: false, error: completeJ.error };
}
