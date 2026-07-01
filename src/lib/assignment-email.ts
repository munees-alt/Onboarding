import { sendHtmlGmailAs } from "./google";
import { getDriveCapableMemberId } from "./google";

export interface AssignmentEmailFields {
  toEmail: string;
  toName: string;
  clientName: string;
  services: string[];
  salesPerson: string;
  runUrl: string;
  orgId: string;
}

function buildHtml(f: AssignmentEmailFields): string {
  const servicesList = f.services.length > 0 ? f.services.join(" - ") : "Accounting";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header with logo -->
        <tr>
          <td style="padding:24px 32px 16px 32px;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:18px;font-weight:700;color:#E85D26;">&#9679;</span>
            <span style="font-size:16px;font-weight:700;color:#1a1a1a;margin-left:6px;">Finanshels</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">
            <h2 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#1a1a1a;">New Onboarding Assignment</h2>
            <p style="margin:0 0 16px 0;font-size:15px;color:#333333;">Dear ${escHtml(f.toName)},</p>
            <p style="margin:0 0 24px 0;font-size:15px;color:#333333;">A new client has been successfully closed and has been assigned to you for onboarding.</p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:14px;font-weight:700;color:#1a1a1a;">Client Name:&nbsp;</span>
                  <span style="font-size:14px;color:#333333;">${escHtml(f.clientName)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:14px;font-weight:700;color:#1a1a1a;">Services:&nbsp;</span>
                  <span style="font-size:14px;color:#333333;">${escHtml(servicesList)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:14px;font-weight:700;color:#1a1a1a;">Sales Person:&nbsp;</span>
                  <span style="font-size:14px;color:#333333;">${escHtml(f.salesPerson)}</span>
                </td>
              </tr>
            </table>
            <a href="${f.runUrl}" style="display:inline-block;background:#E85D26;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">View Client Details</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px 32px;border-top:1px solid #f0f0f0;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#666666;">Best Regards,</p>
            <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#1a1a1a;">Team Finanshels</p>
            <a href="https://finanshels.com" style="font-size:13px;color:#E85D26;text-decoration:none;">Finanshels.com</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(f: AssignmentEmailFields): string {
  const servicesList = f.services.length > 0 ? f.services.join(" - ") : "Accounting";
  return `New Onboarding Assignment

Dear ${f.toName},

A new client has been successfully closed and has been assigned to you for onboarding.

Client Name: ${f.clientName}
Services: ${servicesList}
Sales Person: ${f.salesPerson}

View Client Details: ${f.runUrl}

Best Regards,
Team Finanshels
Finanshels.com`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Sends a "New Onboarding Assignment" email to the assigned AM.
 * Uses the first Google-connected team member as the sender (best-effort — silent on failure).
 */
export async function sendAssignmentEmail(f: AssignmentEmailFields): Promise<void> {
  try {
    const senderId = await getDriveCapableMemberId(f.orgId);
    if (!senderId) return; // no Google-connected sender — skip silently
    await sendHtmlGmailAs(
      senderId,
      f.toEmail,
      "New Onboarding Assignment",
      buildHtml(f),
      buildText(f),
    );
  } catch {
    // best-effort — never throw so run creation isn't blocked
  }
}
