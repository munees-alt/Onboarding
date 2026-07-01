// Email → Liquidation & Audit case automation. Mirrors lead-sync.ts: watches a
// Gmail label ("Cadence Audit and Liquidation") and turns each new email into a
// case — a client (status 'lead') plus an onboarding_run on the audit or
// liquidation template. Audit vs liquidation is inferred from the subject/body
// (defaults to audit). Config lives per-org in al_sync_config, editable from
// Settings. Used by both the cron and the "Sync now" button.
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { listGmailLabels, listGmailMessageIds, getGmailMessage } from "@/lib/google";
import { parsePaymentEmail } from "@/lib/sales-email";
import { createRunFromTemplate } from "@/lib/runs";

export interface AlSyncConfig {
  enabled: boolean;
  gmailLabel: string;
  matchFrom: string | null;
  matchSubjectPrefix: string | null;
  mailboxMemberId: string | null;
  lastSyncedAt: string | null;
  lastResult: { scanned: number; created: number; at: string } | null;
}

export function defaultAlSyncConfig(): AlSyncConfig {
  return {
    enabled: true,
    gmailLabel: "Cadence Audit and Liquidation",
    matchFrom: null,
    matchSubjectPrefix: null,
    mailboxMemberId: null,
    lastSyncedAt: null,
    lastResult: null,
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function getAlSyncConfig(admin: AdminClient, orgId: string): Promise<AlSyncConfig> {
  const { data } = await admin.from("al_sync_config").select("*").eq("org_id", orgId).maybeSingle();
  if (!data) return defaultAlSyncConfig();
  return {
    enabled: data.enabled ?? true,
    gmailLabel: data.gmail_label ?? "Cadence Audit and Liquidation",
    matchFrom: data.match_from ?? null,
    matchSubjectPrefix: data.match_subject_prefix ?? null,
    mailboxMemberId: data.mailbox_member_id ?? null,
    lastSyncedAt: data.last_synced_at ?? null,
    lastResult: data.last_result ?? null,
  };
}

async function resolveMailbox(admin: AdminClient, orgId: string, cfg: AlSyncConfig): Promise<string | null> {
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

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${base || "case"}-${crypto.randomBytes(2).toString("hex")}`;
}

/** Infers the case flow from the email. Liquidation only when clearly signalled; otherwise audit. */
function inferFlow(subject: string, body: string): "liquidation" | "audit" {
  const hay = `${subject}\n${body}`.toLowerCase();
  if (/\bliquidat/.test(hay) && !/\baudit/.test(hay)) return "liquidation";
  if (/\bliquidat/.test(hay) && /\baudit/.test(hay)) return "audit"; // both mentioned → default audit
  if (/\bliquidat/.test(hay)) return "liquidation";
  return "audit";
}

export interface AlSyncResult { scanned: number; created: number; skipped: number; errors: string[]; mailbox: string | null; }

/** Runs the audit/liquidation email sync for one org. Dedupes via al_email_cases. */
export async function runAlSync(orgId: string): Promise<AlSyncResult> {
  const admin = createAdminClient();
  const cfg = await getAlSyncConfig(admin, orgId);
  const result: AlSyncResult = { scanned: 0, created: 0, skipped: 0, errors: [], mailbox: null };
  if (!cfg.enabled) { result.errors.push("Audit & Liquidation sync is disabled."); return result; }

  const mailbox = await resolveMailbox(admin, orgId, cfg);
  result.mailbox = mailbox;
  if (!mailbox) { result.errors.push("No connected Google mailbox. Connect Gmail in Settings."); return result; }

  let labelIds: string[] | undefined;
  if (cfg.gmailLabel.trim()) {
    const labels = await listGmailLabels(mailbox);
    if (!labels.length) {
      result.errors.push("Can't read the mailbox — reconnect Google in Settings to grant Gmail read access, then sync again.");
      return result;
    }
    const norm = (s: string) => s.toLowerCase().trim();
    const label = labels.find((l) => norm(l.name) === norm(cfg.gmailLabel));
    if (label) labelIds = [label.id];
    else result.errors.push(`Gmail label "${cfg.gmailLabel}" not found. Check the exact label name in Settings.`);
  }

  const qParts: string[] = [];
  if (!labelIds && cfg.lastSyncedAt) {
    const epoch = Math.floor(new Date(cfg.lastSyncedAt).getTime() / 1000) - 60;
    qParts.push(`after:${epoch}`);
  } else {
    qParts.push("newer_than:30d");
  }
  if (cfg.matchFrom) qParts.push(`from:${cfg.matchFrom}`);
  if (cfg.matchSubjectPrefix) qParts.push(`subject:"${cfg.matchSubjectPrefix}"`);
  const q = qParts.join(" ");

  if (!labelIds && !cfg.matchFrom && !cfg.matchSubjectPrefix) {
    result.errors.push("No label or filter configured — nothing to watch.");
    return result;
  }

  const ids = await listGmailMessageIds(mailbox, { q, labelIds, max: 50 });

  for (const msgId of ids) {
    result.scanned++;
    const { data: seen } = await admin.from("al_email_cases")
      .select("id").eq("org_id", orgId).eq("gmail_message_id", msgId).maybeSingle();
    if (seen) { result.skipped++; continue; }

    const msg = await getGmailMessage(mailbox, msgId);
    if (!msg) { result.skipped++; continue; }

    if (cfg.matchFrom && !msg.from.toLowerCase().includes(cfg.matchFrom.toLowerCase())) { result.skipped++; continue; }
    if (cfg.matchSubjectPrefix && !msg.subject.trim().toLowerCase().startsWith(cfg.matchSubjectPrefix.toLowerCase())) { result.skipped++; continue; }

    const parsed = parsePaymentEmail(msg.subject, msg.body);
    const companyName = (parsed.companyName || parsed.clientName || msg.subject.replace(/^(re|fwd):\s*/i, "").trim() || "New case").slice(0, 120);
    const flow = inferFlow(msg.subject, msg.body);
    const templateId = flow === "liquidation" ? "liquidation-workflow" : "audit-workflow";

    const { data: client, error: ce } = await admin.from("clients").insert({
      org_id: orgId,
      name: companyName,
      status: "lead",
      profile_complete: false,
      slug: slugify(companyName),
    }).select("id").single();
    if (ce || !client) { result.errors.push(`insert ${msgId}: ${ce?.message}`); continue; }

    let runId: string | null = null;
    try {
      runId = await createRunFromTemplate(admin, {
        orgId,
        clientId: client.id,
        amId: null,
        templateId,
      });
    } catch (e) {
      result.errors.push(`run ${msgId}: ${e instanceof Error ? e.message : "run create failed"}`);
    }

    await admin.from("al_email_cases").insert({
      org_id: orgId, gmail_message_id: msgId, client_id: client.id, run_id: runId,
      flow, subject: msg.subject, from_addr: msg.from,
    });
    result.created++;
  }

  const at = new Date().toISOString();
  await admin.from("al_sync_config").upsert(
    { org_id: orgId, last_synced_at: at, last_result: { scanned: result.scanned, created: result.created, at }, updated_at: at },
    { onConflict: "org_id" },
  );
  return result;
}
