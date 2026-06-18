// Access-grant catalogue + default SOPs. The team picks which accesses a client
// must grant during onboarding; each has a step-by-step SOP shown in the client
// portal. SOPs are editable per run — these are the defaults.
//
// {email} is replaced at render time with the run's authorised-user email
// (defaults to AUTHORISED_USER_EMAIL).

export const AUTHORISED_USER_EMAIL = "suhail@finanshels.com";

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
      "Log in to the FTA portal (eservices.tax.gov.ae).",
      "Click the View button under your company name.",
      "From the left-hand menu, select User Authorization.",
      "Click Add User, set user type as Portal User, and enter {email}.",
      "Ensure WRITE access is granted before saving.",
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
}
