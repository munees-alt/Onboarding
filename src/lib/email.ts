import "server-only";
import { createAdminClient } from "./supabase/admin";

// SendGrid scaffold (platform cleanup, 2026-07). Queuing a batch row is always
// safe — it just writes to email_batch. Actually sending stays a no-op until
// both SENDGRID_API_KEY and ENABLE_EMAIL_SENDING=true are set, so this can ship
// without risk of emailing anyone by accident.

export type EmailKind = "followup" | "data_request" | "team_update" | "other";

export interface QueueEmailInput {
  orgId: string;
  kind: EmailKind;
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text?: string | null;
  clientId?: string | null;
  runId?: string | null;
  createdBy?: string | null;
}

/** Creates a queued batch row. Never sends anything by itself. */
export async function queueEmail(input: QueueEmailInput): Promise<{ id: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_batch")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      to_email: input.to,
      to_name: input.toName ?? null,
      subject: input.subject,
      body_html: input.html,
      body_text: input.text ?? null,
      client_id: input.clientId ?? null,
      run_id: input.runId ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export function emailSendingEnabled(): boolean {
  return !!process.env.SENDGRID_API_KEY && process.env.ENABLE_EMAIL_SENDING === "true";
}

/**
 * Sends one queued row via the SendGrid v3 REST API (no SDK dependency).
 * Guarded by emailSendingEnabled() — callers should check that first; this
 * only exists so the batch cron has something real to call once enabled.
 */
export async function sendQueuedEmail(row: {
  id: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
}): Promise<{ ok: true } | { error: string }> {
  if (!emailSendingEnabled()) return { error: "Email sending is disabled (set SENDGRID_API_KEY + ENABLE_EMAIL_SENDING=true)." };
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) return { error: "SENDGRID_FROM_EMAIL is not set." };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: row.to_email, name: row.to_name ?? undefined }] }],
      from: { email: fromEmail, name: process.env.SENDGRID_FROM_NAME || "Cadence" },
      subject: row.subject,
      content: [
        ...(row.body_text ? [{ type: "text/plain", value: row.body_text }] : []),
        { type: "text/html", value: row.body_html },
      ],
    }),
  });
  if (!res.ok) return { error: `SendGrid ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { ok: true };
}
