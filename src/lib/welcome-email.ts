// Saved welcome-email template for the post-call step. The structure and copy
// are fixed; only the placeholders below are filled in when the step is run, so
// "generate" always produces the same branded email with the client's details
// and the meeting minutes populated.
//
// Placeholders:
//   {contactName}  — the person we met (client owner / primary contact)
//   {companyName}  — the client company name
//   {portalUrl}    — the dispatched client-portal magic link (absolute URL)
//   {momBody}      — the AI-drafted minutes of the meeting (from real notes)

export const WELCOME_EMAIL_SUBJECT = "Welcome to Finanshels — your client portal & meeting notes";

export const WELCOME_EMAIL_TEMPLATE = `Dear {contactName},

Greetings from Finanshels.com!

We are on a mission to simplify financial life for founders, and we are thrilled to have {companyName} onboard. We look forward to serving you for the years to come. Thank you for taking the time to meet with us today.

YOUR CLIENT PORTAL
Please find your secure client portal link below:
{portalUrl}

To log in, enter your email — we will send you a login code. Copy the code from your email, paste it in, and you are in.

Inside the portal you can see your full document list, the access you need to share with us, and your task board. Once all of that is completed, you will get your Live view.

MINUTES OF THE MEETING
{momBody}

Thanks again for giving us the opportunity to serve you. We look forward to building a healthy and long-term relationship.

Best Regards,
Team Finanshels`;

export interface WelcomeEmailFields {
  contactName: string;
  companyName: string;
  portalUrl: string;
  momBody: string;
}

/** Fills the saved template with the run's real details. */
export function renderWelcomeEmail(f: WelcomeEmailFields): string {
  return WELCOME_EMAIL_TEMPLATE
    .replace(/\{contactName\}/g, f.contactName || "there")
    .replace(/\{companyName\}/g, f.companyName || "your company")
    .replace(/\{portalUrl\}/g, f.portalUrl)
    .replace(/\{momBody\}/g, f.momBody.trim());
}
