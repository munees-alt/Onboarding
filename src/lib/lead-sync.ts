// Email → onboarding-lead automation. Single source of truth used by BOTH the cron
// (/api/cron/sales-leads) and the manual "Sync now" button (settings action). Every rule
// (which Gmail label to watch, optional sender/subject filters, the configured service list,
// which mailbox to read) is stored per-org in lead_sync_config and editable from Settings —
// no code change needed to retune it.
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { listGmailLabels, listGmailMessageIds, getGmailMessage, createClientDriveFolder } from "@/lib/google";
import { parsePaymentEmail } from "@/lib/sales-email";

export interface LeadSyncConfig {
  enabled: boolean;
  gmailLabel: string;
  matchFrom: string | null;
  matchSubjectPrefix: string | null;
  services: string[];
  mailboxMemberId: string | null;
  lastSyncedAt: string | null;
  lastResult: { scanned: number; created: number; at: string } | null;
}

const DEFAULT_SERVICES = ["Accounting & Bookkeeping", "Prior-Period Catch-Up & Books Cleanup"];

export function defaultLeadSyncConfig(): LeadSyncConfig {
  return {
    enabled: true,
    gmailLabel: "Cadence Onboarding",
    matchFrom: null,
    matchSubjectPrefix: null,
    services: DEFAULT_SERVICES,
    mailboxMemberId: null,
    lastSyncedAt: null,
    lastResult: null,
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function getLeadSyncConfig(admin: AdminClient, orgId: string): Promise<LeadSyncConfig> {
  const { data } = await admin.from("lead_sync_config").select("*").eq("org_id", orgId).maybeSingle();
  if (!data) return defaultLeadSyncConfig();
  return {
    enabled: data.enabled ?? true,
    gmailLabel: data.gmail_label ?? "Cadence Onboarding",
    matchFrom: data.match_from ?? null,
    matchSubjectPrefix: data.match_subject_prefix ?? null,
    services: Array.isArray(data.services) ? (data.services as string[]) : DEFAULT_SERVICES,
    mailboxMemberId: data.mailbox_member_id ?? null,
    lastSyncedAt: data.last_synced_at ?? null,
    lastResult: data.last_result ?? null,
  };
}

/** Picks which connected Gmail mailbox to read: the configured one (if still connected),
 * else the master admin's, else any connected Google account in the org. */
async function resolveMailbox(admin: AdminClient, orgId: string, cfg: LeadSyncConfig): Promise<string | null> {
  if (cfg.mailboxMemberId) {
    const { data } = await admin.from("member_connections").select("team_member_id")
      .eq("team_member_id", cfg.mailboxMemberId).eq("provider", "google").eq("connected", true).maybeSingle();
    if (data) return cfg.mailboxMemberId;
  }
  const { data: conns } = await admin.from("member_connections")
    .select("team_member_id, team_members(role)")
    .eq("org_id", orgId).eq("provider", "google").eq("connected", true);
  type Row = { team_member_id: string; team_members: { role?: string } | { role?: string }[] | null };
  let fallback: string | null = null;
  for (const c of (conns ?? []) as Row[]) {
    const tm = Array.isArray(c.team_members) ? c.team_members[0] : c.team_members;
    if (tm?.role === "admin") return c.team_member_id;
    fallback ??= c.team_member_id;
  }
  return fallback;
}

/** Normalises a parsed service name to the configured spelling when it matches (case/space-insensitive). */
function canonicalService(name: string, configured: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = configured.find((c) => norm(c) === norm(name));
  return hit ?? name.trim();
}

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${base || "client"}-${crypto.randomBytes(2).toString("hex")}`;
}

export interface LeadSyncResult { scanned: number; created: number; skipped: number; errors: string[]; mailbox: string | null; }

/** Runs the email → lead sync for one org. Incremental: only fetches mail after the last sync.
 * Dedupes via sales_email_leads so the same email never makes two leads. */
export async function runLeadSync(orgId: string): Promise<LeadSyncResult> {
  const admin = createAdminClient();
  const cfg = await getLeadSyncConfig(admin, orgId);
  const result: LeadSyncResult = { scanned: 0, created: 0, skipped: 0, errors: [], mailbox: null };
  if (!cfg.enabled) { result.errors.push("Lead sync is disabled."); return result; }

  const mailbox = await resolveMailbox(admin, orgId, cfg);
  result.mailbox = mailbox;
  if (!mailbox) { result.errors.push("No connected Google mailbox. Connect Gmail in Settings."); return result; }

  // Resolve the watched label to its id.
  let labelIds: string[] | undefined;
  if (cfg.gmailLabel.trim()) {
    const labels = await listGmailLabels(mailbox);
    if (!labels.length) {
      // Empty almost always means the token can't READ Gmail (it was connected with send-only
      // scope). The fix is a one-time Google reconnect to grant Gmail read access.
      result.errors.push("Can't read the mailbox — reconnect Google in Settings to grant Gmail read access, then sync again.");
      return result;
    }
    const norm = (s: string) => s.toLowerCase().trim();
    const label = labels.find((l) => norm(l.name) === norm(cfg.gmailLabel));
    if (label) labelIds = [label.id];
    else result.errors.push(`Gmail label "${cfg.gmailLabel}" not found. Check the exact label name in Settings.`);
  }

  // Build the query. Dedupe (sales_email_leads) is what stops the same email becoming two leads;
  // the date window just limits how much we fetch each run.
  //  • Label mode: scan a recent window — an email can be received first and labelled later, so an
  //    `after:lastSync` cursor would miss it. Dedupe skips anything already turned into a lead.
  //  • From/subject mode: use `after:lastSync` (date-correct) so we only look at new mail.
  const qParts: string[] = [];
  if (!labelIds && cfg.lastSyncedAt) {
    const epoch = Math.floor(new Date(cfg.lastSyncedAt).getTime() / 1000) - 60; // 60s overlap
    qParts.push(`after:${epoch}`);
  } else {
    qParts.push("newer_than:30d");
  }
  if (cfg.matchFrom) qParts.push(`from:${cfg.matchFrom}`);
  if (cfg.matchSubjectPrefix) qParts.push(`subject:"${cfg.matchSubjectPrefix}"`);
  const q = qParts.join(" ");

  // If neither a label nor any filter resolved, refuse rather than scan the whole inbox.
  if (!labelIds && !cfg.matchFrom && !cfg.matchSubjectPrefix) {
    result.errors.push("No label or filter configured — nothing to watch.");
    return result;
  }

  const ids = await listGmailMessageIds(mailbox, { q, labelIds, max: 50 });

  for (const msgId of ids) {
    result.scanned++;
    const { data: seen } = await admin.from("sales_email_leads")
      .select("id").eq("org_id", orgId).eq("gmail_message_id", msgId).maybeSingle();
    if (seen) { result.skipped++; continue; }

    const msg = await getGmailMessage(mailbox, msgId);
    if (!msg) { result.skipped++; continue; }

    // Re-check optional filters precisely (Gmail's from:/subject: search is loose).
    if (cfg.matchFrom && !msg.from.toLowerCase().includes(cfg.matchFrom.toLowerCase())) { result.skipped++; continue; }
    if (cfg.matchSubjectPrefix && !msg.subject.trim().toLowerCase().startsWith(cfg.matchSubjectPrefix.toLowerCase())) { result.skipped++; continue; }

    const parsed = parsePaymentEmail(msg.subject, msg.body);
    const companyName = (parsed.companyName || parsed.clientName || "New lead").trim();
    const services = parsed.services.map((s) => canonicalService(s, cfg.services));

    const { data: client, error: ce } = await admin.from("clients").insert({
      org_id: orgId,
      name: companyName,
      owner_name: parsed.clientName || null,
      services,
      proposal_id: parsed.proposalId,
      am_id: mailbox,
      status: "lead",
      profile_complete: false,
      slug: slugify(companyName),
    }).select("id").single();
    if (ce || !client) { result.errors.push(`insert ${msgId}: ${ce?.message}`); continue; }

    try {
      const drive = await createClientDriveFolder(mailbox, companyName);
      if (drive) await admin.from("drive_folders").upsert(
        { client_id: client.id, tree: { name: companyName, id: drive.id, link: drive.link } },
        { onConflict: "client_id" },
      );
    } catch { /* folder is best-effort */ }

    await admin.from("sales_email_leads").insert({
      org_id: orgId, gmail_message_id: msgId, client_id: client.id,
      subject: msg.subject, from_addr: msg.from, proposal_id: parsed.proposalId,
    });
    result.created++;
  }

  // Mark this sync point (used as the incremental cursor next time).
  const at = new Date().toISOString();
  await admin.from("lead_sync_config").upsert(
    { org_id: orgId, last_synced_at: at, last_result: { scanned: result.scanned, created: result.created, at }, updated_at: at },
    { onConflict: "org_id" },
  );
  return result;
}
