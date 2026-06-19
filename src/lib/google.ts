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
