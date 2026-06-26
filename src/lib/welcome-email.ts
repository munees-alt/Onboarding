// Saved welcome-email template for the post-call step. The structure and copy
// are fixed; only the placeholders below are filled in when the step is run, so
// "generate" always produces the same branded email with the client's details
// and the meeting minutes populated.
//
// Placeholders:
//   {contactName}  — the person we met (client owner / primary contact)
//   {companyName}  — the client company name
//   {portalUrl}    — the dispatched onboarding-portal magic link (absolute URL)
//   {momBody}      — the AI-drafted minutes of the meeting (from real notes)

export const WELCOME_EMAIL_SUBJECT = "Welcome to Finanshels — your onboarding portal & meeting notes";

export const WELCOME_EMAIL_TEMPLATE = `Dear {contactName},

Greetings from Finanshels.com!

We are on a mission to simplify financial life for founders, and we are thrilled to have {companyName} onboard. We look forward to serving you for the years to come. Thank you for taking the time to meet with us today.

YOUR ONBOARDING PORTAL
Please find your secure onboarding portal link below:
{portalUrl}

To log in, enter your email — we will send you a login code. Copy the code from your email, paste it in, and you are in.

Inside the portal you can see your full document list, the access you need to share with us, and your task board. Once all of that is completed, you will get your Live view.

MINUTES OF THE MEETING
{momBody}

Best Regards,
Team Finanshels`;

// WhatsApp group welcome message — the first message dropped into the client's
// WhatsApp group. Only the point of contact changes (the senior we select).
export const WHATSAPP_WELCOME_TEMPLATE = `Greetings from Finanshels!

Welcome onboard. I'm {contact}, and I will be your dedicated point of contact for all accounting-related matters.

This group has been created to ensure smooth and efficient communication for all accounting discussions.

A detailed welcome email containing all the necessary information and requirements will be shared with you shortly.

If you have any questions or concerns, please feel free to reach out. We will be happy to assist you.

Looking forward to working with you ☺️`;

/** Fills the WhatsApp welcome message with the chosen point of contact. */
export function renderWhatsappWelcome(contact: string): string {
  return WHATSAPP_WELCOME_TEMPLATE.replace(/\{contact\}/g, (contact || "").trim() || "your account manager");
}

export interface WelcomeEmailFields {
  contactName: string;
  companyName: string;
  portalUrl: string;
  momBody: string;
}

/**
 * Cleans the AI-drafted minutes so they sit neatly inside the template: the
 * surrounding email already has the subject, greeting and sign-off, so we strip
 * any the model added, drop markdown bold/heading markers (the email is plain
 * text), and tidy whitespace.
 */
export function cleanMinutes(raw: string): string {
  let text = (raw || "").replace(/\r\n/g, "\n").trim();

  // Strip markdown emphasis/heading markers — the email is plain text.
  text = text.replace(/\*\*/g, "").replace(/__/g, "").replace(/^#{1,6}\s+/gm, "");

  let lines = text.split("\n");

  // Drop a leading "Subject: …" line, a "Dear …," greeting, and common
  // pleasantry/preamble lines the model sometimes prepends.
  const PREAMBLE = /^(subject:|dear\b|hi\b|hello\b|i hope this (message|email|note) finds you|it was (a pleasure|great)|thank you for (meeting|taking the time)|below are the minutes|please find (below|the minutes)|as discussed|following (up|our)|further to our)/i;
  while (lines.length) {
    const first = lines[0].trim();
    if (first === "" || PREAMBLE.test(first)) { lines.shift(); continue; }
    break;
  }

  // Drop a trailing sign-off block (the template provides "Best Regards, Team Finanshels").
  // Only strip CONTIGUOUS trailing closer/blank lines — stop the moment we hit a
  // bullet, "Next steps", "Action items", etc., so structured sections at the end
  // are never eaten.
  const SIGNOFF = /^(best regards|warm regards|kind regards|regards|sincerely|cheers|team finanshels|finanshels|signed off|with regards)\b[,.]?$/i;
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || SIGNOFF.test(last)) { lines.pop(); continue; }
    break;
  }

  // Collapse 3+ blank lines to a single blank line.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// =========================================================================
// INTAKE-FORM TEMPLATES — sent right after the client is marked signed, BEFORE
// the kickoff call. Lighter than the full welcome email — its only job is to
// get the client into the portal to fill the intake form.
// =========================================================================

export const INTAKE_EMAIL_SUBJECT = "Welcome to Finanshels — please complete your onboarding form";

export const INTAKE_EMAIL_TEMPLATE = `Dear {contactName},

Welcome to Finanshels! We're excited to start working with {companyName}.

To begin, please complete your onboarding form using your secure onboarding portal:
{portalUrl}

Inside the portal you can fill in your business details, see which documents we'll need, and grant the access we require. The form takes about 10–15 minutes and you can save and come back to it any time. To log in, enter your email — we'll send you a login code.

If anything is unclear, just reply to this email and we'll help.

Best Regards,
Team Finanshels`;

export const INTAKE_WHATSAPP_TEMPLATE = `Hi {contactName} — welcome to Finanshels!

Please complete your onboarding form here: {portalUrl}

Takes about 10 mins. To log in, enter your email and we'll send a code. Reply here if you have any questions.

— Team Finanshels`;

export interface IntakeTemplateFields {
  contactName?: string;
  companyName?: string;
  portalUrl: string;
}

const fill = (tpl: string, f: IntakeTemplateFields) => tpl
  .replace(/\{contactName\}/g, f.contactName?.trim() || "there")
  .replace(/\{companyName\}/g, f.companyName?.trim() || "your company")
  .replace(/\{portalUrl\}/g, f.portalUrl);

export function renderIntakeEmail(f: IntakeTemplateFields): string { return fill(INTAKE_EMAIL_TEMPLATE, f); }
export function renderIntakeWhatsapp(f: IntakeTemplateFields): string { return fill(INTAKE_WHATSAPP_TEMPLATE, f); }

/** Fills the saved template with the run's real details. */
export function renderWelcomeEmail(f: WelcomeEmailFields): string {
  return WELCOME_EMAIL_TEMPLATE
    .replace(/\{contactName\}/g, f.contactName || "there")
    .replace(/\{companyName\}/g, f.companyName || "your company")
    .replace(/\{portalUrl\}/g, f.portalUrl)
    .replace(/\{momBody\}/g, cleanMinutes(f.momBody));
}
