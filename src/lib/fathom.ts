import "server-only";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";

/** The org's stored Fathom API key (any connected member). */
async function getFathomKey(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_connections")
    .select("config")
    .eq("provider", "fathom")
    .eq("connected", true)
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  const enc = (data?.config as { key_enc?: string } | null)?.key_enc;
  if (!enc) return null;
  try { return decryptSecret(enc); } catch { return null; }
}

export type FathomMeeting = {
  title?: string; meeting_title?: string; url?: string; share_url?: string;
  transcript?: unknown; default_summary?: unknown; action_items?: unknown; highlights?: unknown;
  scheduled_start_time?: string; meeting_time?: string; created_at?: string;
  // Fathom returns attendees / participants under multiple shapes — keep them
  // loose so the matcher can probe whatever shows up.
  invitees?: Array<{ email?: string; name?: string }>;
  participants?: Array<{ email?: string; name?: string }>;
  attendees?: Array<{ email?: string; name?: string }>;
};

// Returns every email-looking string found anywhere on the meeting record. Used
// to match a meeting to a client by attendee domain.
export function fathomMeetingEmails(m: FathomMeeting): string[] {
  const out = new Set<string>();
  const scan = (arr?: Array<{ email?: string }>) => (arr ?? []).forEach((p) => { if (p?.email) out.add(p.email.toLowerCase()); });
  scan(m.invitees); scan(m.participants); scan(m.attendees);
  return [...out];
}

/** Returns the full list of meetings from the org's Fathom account, or null if not configured. */
export async function listFathomMeetings(orgId: string): Promise<FathomMeeting[] | null> {
  const key = await getFathomKey(orgId);
  if (!key) return null;
  const res = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true", {
    headers: { "X-Api-Key": key },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return ((j.items ?? j.meetings ?? []) as FathomMeeting[]);
}

/** Joins a Fathom meeting's parts (summary / action items / transcript) into a single notes string. */
export function fathomMeetingNotes(m: FathomMeeting): string {
  const parts: string[] = [];
  const s = asText(m.default_summary); if (s) parts.push("Summary:\n" + s);
  const a = asText(m.action_items);    if (a) parts.push("Action items:\n" + a);
  const t = asText(m.transcript);      if (t) parts.push("Transcript:\n" + t);
  return parts.join("\n\n").slice(0, 28000);
}

function asText(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((seg) => {
      if (typeof seg === "string") return seg;
      const o = seg as Record<string, unknown>;
      // Action items carry an assignee + due date in addition to the text — keep
      // them so the AI can render "owner / due" in the minutes.
      const txt = (o.text ?? o.description ?? o.title ?? o.markdown) as string | undefined;
      const who = (o.assignee_name ?? o.assignee ?? o.owner ?? o.speaker ?? o.speaker_name ?? o.name) as string | undefined;
      const due = (o.due_date ?? o.due_at ?? o.due ?? o.deadline) as string | undefined;
      if (!txt && !who) return "";
      const meta = [who, due ? `due ${String(due).slice(0, 10)}` : ""].filter(Boolean).join(" · ");
      return [meta ? `• ${txt ?? ""} — ${meta}` : `• ${txt ?? ""}`].filter(Boolean).join("");
    }).filter(Boolean).join("\n");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (o.markdown ?? o.text ?? o.summary ?? "") as string || JSON.stringify(v);
  }
  return String(v);
}

/**
 * Pulls a meeting's notes from Fathom — matched by the pasted share/recording URL, or by the
 * client name in the title. Returns combined summary + action items + transcript, or null.
 */
export async function fetchFathomNotes(
  orgId: string,
  opts: { shareUrl?: string | null; clientName?: string | null },
): Promise<{ text: string; title: string; shareUrl: string } | null> {
  const key = await getFathomKey(orgId);
  if (!key) return null;
  const res = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true", {
    headers: { "X-Api-Key": key },
  });
  if (!res.ok) return null;
  const items = ((await res.json()).items ?? []) as FathomMeeting[];
  const link = (opts.shareUrl ?? "").trim();
  const token = link ? link.split("/").pop() ?? "" : "";
  let m: FathomMeeting | undefined;
  if (link) m = items.find((i) => i.share_url === link || i.url === link || (token && (i.share_url?.includes(token) || i.url?.includes(token))));
  if (!m && opts.clientName) {
    const cn = opts.clientName.toLowerCase().slice(0, 18);
    m = items.find((i) => (i.title ?? i.meeting_title ?? "").toLowerCase().includes(cn));
  }
  if (!m) return null;
  const parts: string[] = [];
  const summary = asText(m.default_summary);
  if (summary) parts.push("Summary:\n" + summary);
  const actions = asText(m.action_items);
  if (actions) parts.push("Action items:\n" + actions);
  const transcript = asText(m.transcript);
  if (transcript) parts.push("Transcript:\n" + transcript);
  const text = parts.join("\n\n").slice(0, 28000);
  if (!text.trim()) return null;
  return { text, title: m.title ?? m.meeting_title ?? "", shareUrl: m.share_url ?? link };
}
