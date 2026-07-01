// Saved welcome-email template for the post-call step. The structure and copy
// are fixed; only the placeholders below are filled in when the step is run, so
// "generate" always produces the same branded email with the client's details
// and the meeting minutes populated.
//
// Placeholders:
//   {contactName}  — the person we met (client owner / primary contact)
//   {companyName}  — the client company name
//   {portalUrl}    — the dispatched onboarding-portal magic link (absolute URL)
//   {fathomLink}   — the Fathom (or other) meeting recording link
//   {notesBlock}   — optional extra notes section; empty string when not provided

export const WELCOME_EMAIL_SUBJECT = "Welcome to Finanshels — your onboarding portal & next steps";

export const WELCOME_EMAIL_TEMPLATE = `Dear {contactName},

Greetings from Finanshels.com!

We are on a mission to simplify financial life for founders, and we are thrilled to have you onboard. We look forward to serving you for the years to come. Thank you for taking the time to meet with us. Kindly share the details appended below that are required to start accounting for {companyName}.

Below are the details and access required to proceed:

Please access your onboarding portal where you will find the complete checklist of documents and access we need to get started:
{portalUrl}

To log in, enter your email address — we will send you a verification code. Inside the portal you can view your document checklist, the access items we require, and your onboarding task board.

---

Please find the below details;

Value Added Tax (VAT):
Businesses must register for VAT if their taxable supplies and imports exceed AED 375,000 in the last 12 months or are expected to exceed that in the next 30 days.
Businesses with taxable supplies and imports between AED 187,500 and AED 375,000 can choose to register voluntarily.
VAT returns and payments are due monthly or quarterly depending on turnover. Fines apply for late filing or payment.

Corporate Tax (CT):
CT will apply at a standard rate of 9% on taxable income over AED 375,000.
A 0% rate applies to taxable income up to AED 375,000, so many small businesses will have no CT liability.

Corporate Tax - Small Business Relief:
Qualifying small businesses can elect to be taxed at 0% if their revenue is below AED 3 million in a tax period.
To qualify for the 0% SBR rate, all of the following conditions must be met:
- Revenues below AED 3 million
- No more than 5 employees
- No more than 3 physical trade licenses
- Interests in other UAE businesses not exceeding 25%

---

Please find the meeting recording here: {fathomLink}
{notesBlock}
Action Required:

Share the necessary documents at your earliest convenience.

Thanks again for giving us the opportunity to serve you. We look forward to building a healthy and long-term relationship.

Best Regards,
Team Finanshels`;

// WhatsApp group welcome message — the first message dropped into the client's
// WhatsApp group. Only the point of contact changes (the senior we select).
export const WHATSAPP_WELCOME_TEMPLATE = `Greetings from Finanshels!

Welcome onboard. I'm {contact}, your dedicated point of contact. Finanshels is your complete finance function — accounting, compliance, and reporting — so you can focus on growing your business.

This group is our direct line for all finance-related matters.

A welcome email with everything you need to get started will reach you shortly.

Looking forward to helping {companyName} grow with confidence ☺️`;

/** Fills the WhatsApp welcome message with the chosen point of contact and company name. */
export function renderWhatsappWelcome(contact: string, companyName?: string): string {
  return WHATSAPP_WELCOME_TEMPLATE
    .replace(/\{contact\}/g, (contact || "").trim() || "your account manager")
    .replace(/\{companyName\}/g, (companyName || "").trim() || "your business");
}

export interface WelcomeEmailFields {
  contactName: string;
  companyName: string;
  portalUrl: string;
  fathomLink: string;
  notes?: string;
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

Welcome to Finanshels — your complete finance function for a fixed monthly fee.

We are here to help {companyName} know its numbers, stay compliant, and grow with confidence. The next step is to complete your onboarding form through your secure portal:
{portalUrl}

Inside you can fill in your business details, see which documents we need, and grant the access we require. The form takes about 10–15 minutes and you can save and return to it at any time. To log in, enter your email — we will send you a login code.

If anything is unclear, just reply to this email and we will help.

Best Regards,
Team Finanshels`;

export const INTAKE_WHATSAPP_TEMPLATE = `Hi {contactName} — welcome to Finanshels, your complete finance function!

Please complete your onboarding form here: {portalUrl}

Takes about 10 mins. To log in, enter your email and we'll send you a code. Reply here if you have any questions.

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
  const notesBlock = f.notes?.trim()
    ? `\n${f.notes.trim()}\n`
    : "";
  return WELCOME_EMAIL_TEMPLATE
    .replace(/\{contactName\}/g, f.contactName || "there")
    .replace(/\{companyName\}/g, f.companyName || "your company")
    .replace(/\{portalUrl\}/g, f.portalUrl)
    .replace(/\{fathomLink\}/g, f.fathomLink || "(recording link not available)")
    .replace(/\{notesBlock\}/g, notesBlock);
}
