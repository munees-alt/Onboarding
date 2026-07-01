import "server-only";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret, encryptSecret } from "./crypto";

const DEFAULT_DRIVE_ROOT_FOLDER_ID =
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1r-FdD4NRrMvKD4tITiY6PTglo1z_Cy4_";

export interface DriveFolderNode {
  name: string;
  children?: DriveFolderNode[];
  id?: string;
  link?: string;
}

/**
 * Finds a team member who can write to Drive on this run's behalf: prefers a
 * member assigned to the run who has Google connected; otherwise falls back to
 * ANY connected Google account in the org (e.g. the admin's). This is what makes
 * client/team document uploads actually land in Drive even when the assigned
 * accountants haven't personally connected Google.
 */
export async function getDriveCapableMemberId(orgId: string | null, runId?: string | null): Promise<string | null> {
  const admin = createAdminClient();
  if (runId) {
    const { data: rt } = await admin.from("run_team").select("team_member_id").eq("run_id", runId);
    const ids = (rt ?? []).map((r) => r.team_member_id).filter(Boolean);
    if (ids.length) {
      const { data: conn } = await admin
        .from("member_connections")
        .select("team_member_id")
        .eq("provider", "google").eq("connected", true)
        .in("team_member_id", ids)
        .limit(1);
      if (conn?.[0]?.team_member_id) return conn[0].team_member_id as string;
    }
  }
  let q = admin.from("member_connections").select("team_member_id").eq("provider", "google").eq("connected", true);
  if (orgId) q = q.eq("org_id", orgId);
  const { data: anyConn } = await q.limit(1);
  return (anyConn?.[0]?.team_member_id as string) ?? null;
}

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

async function getDriveRootFolderId(teamMemberId: string): Promise<string | undefined> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_connections")
    .select("drive_root_folder_id,config")
    .eq("team_member_id", teamMemberId)
    .eq("provider", "google")
    .maybeSingle();
  const config = data?.config as { driveRootFolderId?: string } | null;
  return data?.drive_root_folder_id ?? config?.driveRootFolderId ?? DEFAULT_DRIVE_ROOT_FOLDER_ID;
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

/** Sends an HTML email via the member's Gmail (MIME multipart with text fallback). */
export async function sendHtmlGmailAs(
  teamMemberId: string,
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return { ok: false, error: "Connect Google in Settings first." };
  const boundary = "cadence_boundary_" + Math.random().toString(36).slice(2);
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    textBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
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

/** Lists Gmail message ids matching a Gmail search query (e.g. 'from:sales@finanshels.com newer_than:7d'). */
export async function listGmailMessages(teamMemberId: string, query: string, max = 25): Promise<string[]> {
  return listGmailMessageIds(teamMemberId, { q: query, max });
}

/** Lists the member's Gmail labels (id + name) so we can watch a named label like "Cadence Onboarding". */
export async function listGmailLabels(teamMemberId: string): Promise<{ id: string; name: string }[]> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return [];
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { labels?: { id: string; name: string }[] };
  return (j.labels ?? []).map((l) => ({ id: l.id, name: l.name }));
}

/** Lists Gmail message ids by free-text query and/or label ids (e.g. {labelIds:[id], q:'after:1700000000'}). */
export async function listGmailMessageIds(
  teamMemberId: string,
  opts: { q?: string; labelIds?: string[]; max?: number },
): Promise<string[]> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return [];
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  for (const id of opts.labelIds ?? []) params.append("labelIds", id);
  params.set("maxResults", String(opts.max ?? 25));
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { messages?: { id: string }[] };
  return (j.messages ?? []).map((m) => m.id);
}

export interface GmailMessage { id: string; subject: string; from: string; date: string; body: string; }

/** Decodes base64url Gmail body parts into a UTF-8 string. */
function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** Converts an HTML email body to line-structured plain text. Table rows and block
 * elements become newlines, table cells become spaces, so "Label: value" stays on one
 * line — which is what the field parser relies on. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(tr|p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Walks a Gmail payload tree, preferring text/plain, falling back to a structured text/html. */
function extractGmailBody(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const body = payload.body as { data?: string } | undefined;
  const mime = payload.mimeType as string | undefined;
  if (mime === "text/plain" && body?.data) return decodeB64Url(body.data);
  const parts = (payload.parts as Record<string, unknown>[] | undefined) ?? [];
  // Prefer plain text anywhere in the tree.
  for (const p of parts) { const t = extractGmailBody(p); if (t && (p.mimeType as string) === "text/plain") return t; }
  for (const p of parts) { const t = extractGmailBody(p); if (t) return t; }
  if (mime === "text/html" && body?.data) return htmlToText(decodeB64Url(body.data));
  return "";
}

/** Fetches one Gmail message with its subject, from, date and decoded text body. */
export async function getGmailMessage(teamMemberId: string, messageId: string): Promise<GmailMessage | null> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return null;
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { id: string; payload?: Record<string, unknown> };
  const headers = ((j.payload?.headers as { name: string; value: string }[] | undefined) ?? []);
  const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return { id: j.id, subject: h("Subject"), from: h("From"), date: h("Date"), body: extractGmailBody(j.payload) };
}

/** Find a Drive folder by name under an optional parent, creating it if missing. Returns the folder id. */
async function ensureDriveFolder(token: string, name: string, parentId?: string): Promise<{ id: string; link: string } | null> {
  const safe = name.replace(/'/g, "\\'");
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safe}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(" and ");
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (find.ok) {
    const j = await find.json();
    if (j.files?.[0]?.id) {
      const id = j.files[0].id as string;
      return { id, link: j.files[0].webViewLink ?? `https://drive.google.com/drive/folders/${id}` };
    }
  }
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!create.ok) return null;
  const j = await create.json();
  return { id: j.id as string, link: j.webViewLink ?? `https://drive.google.com/drive/folders/${j.id}` };
}

async function ensureDriveFolderTree(token: string, node: DriveFolderNode, parentId?: string): Promise<DriveFolderNode | null> {
  const folder = await ensureDriveFolder(token, node.name, parentId);
  if (!folder) return null;
  const children: DriveFolderNode[] = [];
  for (const child of node.children ?? []) {
    const created = await ensureDriveFolderTree(token, child, folder.id);
    if (created) children.push(created);
  }
  return { ...node, id: folder.id, link: folder.link, children: children.length ? children : node.children };
}

/** Creates a client folder under the configured shared Drive root. */
export async function createClientDriveFolder(
  teamMemberId: string,
  clientName: string,
): Promise<{ id: string; link: string } | null> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return null;
  const rootId = await getDriveRootFolderId(teamMemberId);
  return ensureDriveFolder(token, clientName, rootId);
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string | null;
  size: string | null;
}

/** Lists all non-trashed files (not sub-folders) directly inside a Drive folder. */
export async function listDriveFolder(
  teamMemberId: string,
  folderId: string,
): Promise<DriveFile[]> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return [];
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = "files(id,name,mimeType,webViewLink,modifiedTime,size)";
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const j = await res.json();
  return (j.files ?? []) as DriveFile[];
}

/** Moves a Drive folder to trash (soft-delete). Best-effort — does not throw. */
export async function trashDriveFolder(teamMemberId: string, folderId: string): Promise<void> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Creates the full client Drive tree under the configured shared Drive root. */
export async function createClientDriveTree(
  teamMemberId: string,
  tree: DriveFolderNode,
): Promise<DriveFolderNode | null> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return null;
  const rootId = await getDriveRootFolderId(teamMemberId);
  return ensureDriveFolderTree(token, tree, rootId);
}

/**
 * Uploads a client document into the configured Drive root under `<client>`.
 * Returns the Drive web link, or null if the member isn't connected / the API fails.
 */
export async function uploadClientDocToDrive(
  teamMemberId: string,
  clientName: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<{ link: string; fileId: string } | null> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return null;
  const rootId = await getDriveRootFolderId(teamMemberId);
  const root = rootId ? { id: rootId } : await ensureDriveFolder(token, "Cadence");
  if (!root?.id) return null;
  const folder = await ensureDriveFolder(token, clientName, root.id);
  if (!folder) return null;
  const boundary = "cadence" + buffer.length.toString(36);
  const meta = JSON.stringify({ name: filename, parents: [folder.id] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { link: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`, fileId: j.id };
}

/**
 * Shares a Drive file/folder with a set of email addresses at the given role
 * ("writer" = editor, "reader" = view-only). Best-effort per email; returns the
 * list of emails that were granted access. Skips blanks/dupes.
 */
export async function shareDriveFolder(
  teamMemberId: string,
  fileId: string,
  emails: string[],
  role: "writer" | "reader" = "writer",
): Promise<{ shared: string[]; error?: string }> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return { shared: [], error: "No connected Google account to share from." };
  const unique = [...new Set(emails.map((e) => (e || "").trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))];
  const shared: string[] = [];
  for (const email of unique) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ role, type: "user", emailAddress: email }),
        },
      );
      if (res.ok) shared.push(email);
    } catch { /* skip this email */ }
  }
  return { shared };
}

/** Extracts the Drive file id from a webViewLink like https://drive.google.com/file/d/<ID>/view */
export function driveFileIdFromLink(link: string): string | null {
  return link.match(/\/d\/([^/]+)/)?.[1] ?? link.match(/[?&]id=([^&]+)/)?.[1] ?? null;
}

/** Downloads a Drive file's bytes (alt=media) using the member's token. */
export async function downloadDriveFile(teamMemberId: string, fileId: string): Promise<Buffer | null> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** Find a folder id by name under a parent (search only, no create). */
async function findFolderId(token: string, name: string, parentId?: string): Promise<string | null> {
  const safe = name.replace(/'/g, "\\'");
  const q = ["mimeType='application/vnd.google-apps.folder'", `name='${safe}'`, "trashed=false", parentId ? `'${parentId}' in parents` : null].filter(Boolean).join(" and ");
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return (await r.json()).files?.[0]?.id ?? null;
}
async function listChildren(token: string, parentId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  return (await r.json()).files ?? [];
}

/**
 * Lists every (non-folder) file in the client's Drive "Company Documents" folder and its
 * sub-folders. Falls back to the client root folder if "Company Documents" isn't found.
 */
export async function listClientDriveDocs(teamMemberId: string, clientName: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return [];
  const rootId = (await getDriveRootFolderId(teamMemberId)) ?? (await findFolderId(token, "Cadence"));
  if (!rootId) return [];
  const clientId = await findFolderId(token, clientName, rootId);
  if (!clientId) return [];
  return listDocsUnderFolder(token, clientId);
}

/**
 * Lists the client's documents starting from a KNOWN client-folder id (saved at client creation
 * in drive_folders.tree.id) — no fragile name matching. Reads the "Company Documents" sub-folder
 * (or the folder itself) and recurses through nested sub-folders so files filed two levels deep
 * (e.g. Company Documents/Company/Trade Licence.pdf) are still found.
 */
export async function listDriveDocsByFolderId(teamMemberId: string, clientFolderId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const token = await getValidGoogleToken(teamMemberId);
  if (!token) return [];
  return listDocsUnderFolder(token, clientFolderId);
}

/** Shared: from a client folder, descend into "Company Documents" (if present) and collect files
 *  across nested sub-folders (depth-limited to avoid runaway crawls). */
async function listDocsUnderFolder(token: string, clientFolderId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const baseId = (await findFolderId(token, "Company Documents", clientFolderId)) ?? clientFolderId;
  const isFolder = (m: string) => m === "application/vnd.google-apps.folder";
  const out: { id: string; name: string; mimeType: string }[] = [];
  const seen = new Set<string>();
  const walk = async (folderId: string, depth: number) => {
    if (depth > 3 || seen.has(folderId)) return;
    seen.add(folderId);
    for (const f of await listChildren(token, folderId)) {
      if (isFolder(f.mimeType)) await walk(f.id, depth + 1);
      else out.push(f);
    }
  };
  await walk(baseId, 0);
  return out;
}
