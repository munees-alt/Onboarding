// Access-grant catalogue + default SOPs. The team picks which accesses a client
// must grant during onboarding; each has a step-by-step SOP shown in the client
// portal. SOPs are editable per run — these are the defaults.
//
// {email} is replaced at render time with the run's authorised-user email
// (defaults to AUTHORISED_USER_EMAIL).

export const AUTHORISED_USER_EMAIL = "secure@finanshels.com";

/** Short, email-safe slug for the per-client secure alias (e.g. secure+freshdaily@finanshels.com). */
export function clientEmailSlug(name: string): string {
  const first = (name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return first.slice(0, 12) || "client";
}

export interface AccessType {
  id: string;
  label: string;
  category: "Tax" | "Banking" | "Payments" | "Software" | "Payroll" | "Other";
  /** How access is typically given — first option is the recommended default. */
  methods: string[];
  /** Default SOP (one instruction per line). */
  sop: string[];
}

export const ACCESS_TYPES: AccessType[] = [
  {
    id: "fta_portal",
    label: "FTA Portal (VAT / Corporate Tax)",
    category: "Tax",
    methods: ["Add us as an Authorised User (recommended)", "Share login credentials"],
    sop: [
      "Log into your EmaraTax portal.",
      "Click View under your profile name / company name.",
      "Click on Account Access (visible almost in the middle of the screen).",
      "Click on Add User.",
      "Select user type as Portal User.",
      "Enter {email}.",
      "Select authorisation type as Write Access if you want us to be able to make changes to your tax profile, or Display Access if you want to only provide view access.",
      "Finally, click Add User.",
      "Confirm here once access has been granted so we can proceed.",
    ],
  },
  {
    id: "bank",
    label: "Bank account access",
    category: "Banking",
    methods: ["Add us as a view-only / read-only user (recommended)", "Enable e-statements to our email", "Share statements manually"],
    sop: [
      "Log in to your corporate online banking.",
      "Go to User Management / Manage Users (or ask your relationship manager).",
      "Add a new user with VIEW / READ-ONLY rights (no payment rights) for {email}.",
      "If your bank can't add users, enable scheduled e-statements to {email} instead.",
      "Confirm here once done, or upload the latest statements in the Documents step.",
    ],
  },
  {
    id: "payment_gateway",
    label: "Payment gateway (Telr / Stripe / Network / etc.)",
    category: "Payments",
    methods: ["Invite us as a team member (recommended)", "Share reporting / API access"],
    sop: [
      "Log in to your payment gateway dashboard.",
      "Open Settings → Team / Users.",
      "Invite {email} with reporting / accountant access (no payout rights needed).",
      "Confirm here once the invite is sent.",
    ],
  },
  {
    id: "accounting_software",
    label: "Accounting software (Zoho / QuickBooks / Xero)",
    category: "Software",
    methods: ["Invite us as a user (recommended)", "Share login credentials"],
    sop: [
      "Log in to your accounting software.",
      "Open Settings → Users & Roles.",
      "Invite {email} as an Accountant / Admin user.",
      "Confirm here once the invite is accepted.",
    ],
  },
  {
    id: "payroll_wps",
    label: "Payroll / WPS system",
    category: "Payroll",
    methods: ["Add us as a user (recommended)", "Share login credentials"],
    sop: [
      "Log in to your payroll / WPS provider.",
      "Add {email} as a user with payroll view + processing rights as agreed.",
      "Confirm here once access is granted.",
    ],
  },
  {
    id: "ecommerce",
    label: "E-commerce / marketplace (Amazon / Noon / Shopify)",
    category: "Software",
    methods: ["Invite us as a user (recommended)", "Share reporting access"],
    sop: [
      "Log in to your seller / store dashboard.",
      "Open Settings → Users / Permissions.",
      "Invite {email} with finance / reporting access.",
      "Confirm here once the invite is sent.",
    ],
  },
  {
    id: "other",
    label: "Other system",
    category: "Other",
    methods: ["Add us as a user (recommended)", "Share credentials"],
    sop: [
      "Add {email} as a user to the system, or share read access.",
      "Confirm here once done.",
    ],
  },
];

export const accessTypeById = (id: string) => ACCESS_TYPES.find((a) => a.id === id);

/** Substitute the authorised-user email into an SOP line. */
export function renderSopLine(line: string, email: string): string {
  return line.replace(/\{email\}/g, email || AUTHORISED_USER_EMAIL);
}

/** How the client shares this access:
 *   viewer      — they add us as a read-only / authorised user (the SOP flow).
 *   credentials — they paste the login username + password into the portal; we store it encrypted. */
export type AccessMode = "viewer" | "credentials";

/** Default SOP shown for a credentials-mode access — the client just pastes the login below. */
export const CREDENTIALS_SOP = [
  "Copy your login username and password for this system.",
  "Paste them into the secure Username and Password boxes below.",
  "Click Save — your team receives them encrypted and confirms here once verified.",
];

/** Shape stored per access item in run_items (kind = 'access'). */
export interface AccessItem {
  id: string;        // access type id (or custom id)
  label: string;     // editable display label
  method: string;
  email: string;     // authorised-user email
  sop: string[];     // editable SOP lines
  systemName?: string; // e.g. specific bank / gateway name
  status: "requested" | "granted";
  note?: string;     // client note on grant
  accessMode?: AccessMode; // default "viewer"
  sharedVia?: string;  // how it was shared, set by the team: "Email" | "Zoho Vault" | "Viewer access" | "Credentials" | …
  manual?: boolean;    // true when the team added/edited this from the client playbook (vs configured on the run/confirmed in the portal)
  // Credentials mode only — password is encrypted at rest (AES-256, see crypto.ts).
  credUsername?: string;
  credPasswordEnc?: string;
  credSavedAt?: string;
}
