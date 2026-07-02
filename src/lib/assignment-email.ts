import { queueAndSend } from "./email";

// All assignment-notification emails are sent via SendGrid FROM this mailbox
// (per spec). Delivery is immediate on prod (queueAndSend) — not the daily cron.
const FROM_EMAIL = "munees@finanshels.com";
const FROM_NAME = "Finanshels";

function appBase() {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://onboarding-iota-umber.vercel.app").replace(/\/+$/, "");
}
function runUrl(runId: string) {
  return `${appBase()}/onboarding/${runId}`;
}
function clientUrl(clientId: string) {
  return `${appBase()}/clients/${clientId}`;
}
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface BrandedParams {
  title: string;
  toName: string;
  intro: string;
  rows: { label: string; value: string }[];
  button?: { url: string; label: string };
}

// The reference "New Onboarding Assignment" layout, generalised for every module.
function buildHtml(p: BrandedParams): string {
  const rows = p.rows
    .filter((r) => r.value && r.value.trim())
    .map(
      (r) => `<tr><td style="padding:6px 0;">
        <span style="font-size:14px;font-weight:700;color:#1a1a1a;">${escHtml(r.label)}:&nbsp;</span>
        <span style="font-size:14px;color:#333333;">${escHtml(r.value)}</span></td></tr>`,
    )
    .join("");
  const btn = p.button
    ? `<a href="${p.button.url}" style="display:inline-block;background:#E85D26;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">${escHtml(p.button.label)}</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 32px 16px 32px;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:18px;font-weight:700;color:#E85D26;">&#9679;</span>
        <span style="font-size:16px;font-weight:700;color:#1a1a1a;margin-left:6px;">Finanshels</span>
      </td></tr>
      <tr><td style="padding:32px 32px 24px 32px;">
        <h2 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#1a1a1a;">${escHtml(p.title)}</h2>
        <p style="margin:0 0 16px 0;font-size:15px;color:#333333;">Dear ${escHtml(p.toName)},</p>
        <p style="margin:0 0 24px 0;font-size:15px;color:#333333;">${escHtml(p.intro)}</p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">${rows}</table>
        ${btn}
      </td></tr>
      <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #f0f0f0;">
        <p style="margin:0 0 4px 0;font-size:13px;color:#666666;">Best Regards,</p>
        <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#1a1a1a;">Team Finanshels</p>
        <a href="https://finanshels.com" style="font-size:13px;color:#E85D26;text-decoration:none;">Finanshels.com</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function buildText(p: BrandedParams): string {
  return (
    `${p.title}\n\nDear ${p.toName},\n\n${p.intro}\n\n` +
    p.rows.filter((r) => r.value?.trim()).map((r) => `${r.label}: ${r.value}`).join("\n") +
    (p.button ? `\n\n${p.button.label}: ${p.button.url}` : "") +
    `\n\nBest Regards,\nTeam Finanshels\nFinanshels.com`
  );
}

// Core transport — always FROM munees@finanshels.com; never throws.
async function send(opts: {
  orgId: string;
  to: string;
  cc?: string[];
  subject: string;
  params: BrandedParams;
  clientId?: string | null;
  runId?: string | null;
}): Promise<void> {
  try {
    if (!opts.to) return;
    await queueAndSend({
      orgId: opts.orgId,
      kind: "team_update",
      to: opts.to,
      toName: opts.params.toName,
      subject: opts.subject,
      html: buildHtml(opts.params),
      text: buildText(opts.params),
      clientId: opts.clientId ?? null,
      runId: opts.runId ?? null,
      fromEmail: FROM_EMAIL,
      fromName: FROM_NAME,
      cc: opts.cc && opts.cc.length ? opts.cc : undefined,
    });
  } catch {
    // best-effort — assignment/run flows must never break on email failure
  }
}

// ── 1. Onboarding — AM assignment (keeps original signature/call site) ──
export interface AssignmentEmailFields {
  toEmail: string;
  toName: string;
  clientName: string;
  services: string[];
  salesPerson: string;
  runUrl: string;
  orgId: string;
  clientId?: string | null;
  runId?: string | null;
}
export async function sendAssignmentEmail(f: AssignmentEmailFields): Promise<void> {
  await send({
    orgId: f.orgId,
    to: f.toEmail,
    subject: "New Onboarding Assignment",
    clientId: f.clientId,
    runId: f.runId,
    params: {
      title: "New Onboarding Assignment",
      toName: f.toName,
      intro: "A new client has been successfully closed and has been assigned to you for onboarding.",
      rows: [
        { label: "Client Name", value: f.clientName },
        { label: "Services", value: f.services.length ? f.services.join(" - ") : "Accounting" },
        { label: "Sales Person", value: f.salesPerson },
      ],
      button: { url: f.runUrl, label: "View Client Details" },
    },
  });
}

// ── 2. Onboarding team assignment (also Audit / Liquidation via moduleLabel) ──
export async function sendTeamAssignmentEmail(opts: {
  orgId: string;
  toEmail: string;
  toName: string;
  clientName: string;
  teamLead?: string | null;
  members: string[];
  runId: string;
  clientId?: string | null;
  moduleLabel?: string; // "Onboarding" | "Audit" | "Liquidation"
}): Promise<void> {
  const mod = opts.moduleLabel ?? "Onboarding";
  await send({
    orgId: opts.orgId,
    to: opts.toEmail,
    subject: `${mod} — You've been assigned to a client`,
    clientId: opts.clientId,
    runId: opts.runId,
    params: {
      title: `New ${mod} Assignment`,
      toName: opts.toName,
      intro: `You have been assigned to work on ${opts.clientName}'s ${mod.toLowerCase()}. Here is your team.`,
      rows: [
        { label: "Client Name", value: opts.clientName },
        { label: "Team Lead", value: opts.teamLead ?? "" },
        { label: "Team Members", value: opts.members.join(", ") },
      ],
      button: { url: runUrl(opts.runId), label: "View Client Details" },
    },
  });
}

// ── 3. AML — assigned (To: head, CC: configured team) ──
export async function sendAmlAssignmentEmail(opts: {
  orgId: string;
  headEmail: string;
  headName: string;
  clientName: string;
  ccEmails?: string[];
  clientId?: string | null;
}): Promise<void> {
  await send({
    orgId: opts.orgId,
    to: opts.headEmail,
    cc: opts.ccEmails,
    subject: `AML Compliance — New assignment: ${opts.clientName}`,
    clientId: opts.clientId,
    params: {
      title: "New AML Compliance Assignment",
      toName: opts.headName,
      intro: `A client has been assigned for AML compliance. The team has been copied on this email.`,
      rows: [{ label: "Client Name", value: opts.clientName }],
      button: opts.clientId ? { url: clientUrl(opts.clientId), label: "View Client Details" } : undefined,
    },
  });
}

// ── 4. AML — document created (To: munees@finanshels.com) ──
export async function sendAmlDocumentCreatedEmail(opts: {
  orgId: string;
  clientName: string;
  clientId?: string | null;
}): Promise<void> {
  await send({
    orgId: opts.orgId,
    to: "munees@finanshels.com",
    subject: `AML document created: ${opts.clientName}`,
    clientId: opts.clientId,
    params: {
      title: "AML Document Created",
      toName: "Munees",
      intro: `The AML document has been created for the following client.`,
      rows: [{ label: "Client Name", value: opts.clientName }],
      button: opts.clientId ? { url: clientUrl(opts.clientId), label: "View Client Details" } : undefined,
    },
  });
}

// ── 5. Tax — assigned (To: assignee, CC: tax head e.g. Nafila) ──
export async function sendTaxAssignmentEmail(opts: {
  orgId: string;
  toEmail: string;
  toName: string;
  clientName: string;
  ccEmails?: string[];
  clientId?: string | null;
}): Promise<void> {
  await send({
    orgId: opts.orgId,
    to: opts.toEmail,
    cc: opts.ccEmails,
    subject: `Tax Compliance — New assignment: ${opts.clientName}`,
    clientId: opts.clientId,
    params: {
      title: "New Tax Compliance Assignment",
      toName: opts.toName,
      intro: `A client has been assigned to you for tax compliance.`,
      rows: [{ label: "Client Name", value: opts.clientName }],
      button: opts.clientId ? { url: clientUrl(opts.clientId), label: "View Client Details" } : undefined,
    },
  });
}

// ── 6. Generic module assignment (Catch-up, etc.) ──
export async function sendModuleAssignmentEmail(opts: {
  orgId: string;
  toEmail: string;
  toName: string;
  clientName: string;
  moduleLabel: string;
  runId?: string | null;
  clientId?: string | null;
}): Promise<void> {
  await send({
    orgId: opts.orgId,
    to: opts.toEmail,
    subject: `${opts.moduleLabel} — New assignment: ${opts.clientName}`,
    clientId: opts.clientId,
    runId: opts.runId,
    params: {
      title: `New ${opts.moduleLabel} Assignment`,
      toName: opts.toName,
      intro: `A client has been assigned to you for ${opts.moduleLabel.toLowerCase()}.`,
      rows: [{ label: "Client Name", value: opts.clientName }],
      button: opts.runId ? { url: runUrl(opts.runId), label: "View Client Details" } : undefined,
    },
  });
}
