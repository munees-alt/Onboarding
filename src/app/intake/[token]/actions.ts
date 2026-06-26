"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export type IntakeFieldKind = "text" | "longtext" | "chips" | "select" | "file";
export interface IntakeField {
  key: string;
  label: string;
  kind: IntakeFieldKind;
  options?: string[];
  hint?: string;
}

/** A single uploaded file recorded against a "file" intake field. */
export interface IntakeFileRef {
  name: string;
  storagePath: string;
  size: number;
  uploadedAt: string;
}

export interface PublicIntakeData {
  clientName: string;
  companyEmail: string | null;
  fields: IntakeField[];
  answers: Record<string, unknown>;
  submittedAt: string | null;
}

/**
 * Bank list curated for the UAE market — onshore commercial banks, key
 * Islamic banks, foreign banks active locally and the digital/neo banks
 * UAE clients commonly use. Free-text entry still allowed for anything missing.
 */
const UAE_BANKS = [
  "Emirates NBD", "First Abu Dhabi Bank (FAB)", "Abu Dhabi Commercial Bank (ADCB)", "Mashreq",
  "Dubai Islamic Bank (DIB)", "Abu Dhabi Islamic Bank (ADIB)", "RAKBANK", "Commercial Bank of Dubai (CBD)",
  "Emirates Islamic", "Sharjah Islamic Bank", "Union National Bank", "National Bank of Fujairah (NBF)",
  "Bank of Sharjah", "Ajman Bank", "HSBC UAE", "Citibank UAE", "Standard Chartered UAE",
  "Wio Bank", "Mashreq NEO", "Liv. by Emirates NBD", "Zand Bank", "Al Maryah Community Bank",
];

/**
 * Industry-specific suggestion chips for the revenue and expense fields. The
 * matcher is light — substring on the client's industry text — and falls back
 * to a generic set if nothing matches. Free-text entry still wins.
 */
const REVENUE_BY_INDUSTRY: Record<string, string[]> = {
  retail: ["Storefront sales", "Online sales", "Wholesale orders", "Marketplace (Noon/Amazon)", "Custom orders"],
  ecommerce: ["Website sales", "Marketplace (Noon/Amazon)", "Subscription boxes", "Drop-shipping", "Affiliate revenue"],
  saas: ["Monthly subscriptions", "Annual contracts", "Setup & onboarding fees", "Usage-based fees", "Professional services"],
  technology: ["Project-based development", "Maintenance retainers", "Software licensing", "Consulting hours"],
  restaurant: ["Dine-in", "Delivery (Talabat/Deliveroo)", "Takeaway", "Catering", "Private events"],
  hospitality: ["Room bookings", "F&B", "Events & banquets", "Spa / activities", "Membership"],
  trading: ["Local resale", "Re-export", "Wholesale", "Distribution fees"],
  "import export": ["Imports for resale", "Re-export", "Distribution", "Brokerage fees"],
  fintech: ["Transaction fees", "Subscription tiers", "Interchange / FX margin", "Licensing", "Professional services"],
  professional: ["Hourly billings", "Retainers", "Project fees", "Success / success-fee bonuses"],
  services: ["Retainers", "Project fees", "Hourly billings", "Consulting workshops"],
  manufacturing: ["B2B sales", "OEM contracts", "Custom production", "Export sales"],
  construction: ["Project contracts", "Milestone billings", "Subcontract revenue", "Maintenance contracts"],
  healthcare: ["Consultations", "Procedures", "Diagnostics", "Pharmacy", "Insurance settlements"],
  education: ["Tuition", "Course fees", "Corporate training", "Books & materials"],
  marketing: ["Retainers", "Project fees", "Ad-spend management fees", "Production & design"],
  agency: ["Retainers", "Project fees", "Performance fees", "Media commissions"],
  realestate: ["Sales commission", "Leasing commission", "Property management fees", "Consulting"],
  logistics: ["Freight (sea/air/land)", "Warehousing", "Clearance & customs", "Last-mile delivery"],
};

const EXPENSE_BY_INDUSTRY: Record<string, string[]> = {
  retail: ["Cost of goods sold", "Rent (store)", "Salaries", "Marketing", "Packaging", "Card / gateway fees"],
  ecommerce: ["Cost of goods sold", "Shipping & fulfilment", "Marketing (ads)", "Platform fees", "Salaries"],
  saas: ["Cloud hosting (AWS/Azure)", "Salaries (engineering)", "Sales & marketing", "Tooling subscriptions", "Customer support"],
  technology: ["Salaries", "Cloud / hosting", "Subcontractors", "Software licences", "Office & admin"],
  restaurant: ["Food cost", "Salaries", "Rent", "Aggregator commission", "Utilities", "Licensing"],
  hospitality: ["Salaries", "F&B cost", "Maintenance", "OTAs commission", "Utilities", "Cleaning"],
  trading: ["Cost of inventory", "Salaries", "Logistics / freight", "Storage / warehousing", "Customs duties"],
  "import export": ["Cost of inventory", "Shipping / freight", "Customs duties", "Salaries", "Warehousing"],
  fintech: ["Card-scheme fees", "Salaries", "Cloud / hosting", "Compliance & legal", "Marketing"],
  professional: ["Salaries", "Office rent", "Subscriptions / licences", "Travel", "Marketing"],
  services: ["Salaries", "Rent", "Subscriptions", "Subcontractors", "Marketing"],
  manufacturing: ["Raw materials", "Salaries (factory)", "Utilities", "Maintenance", "Logistics"],
  construction: ["Subcontractors", "Materials", "Equipment hire", "Salaries", "Site overheads"],
  healthcare: ["Salaries (clinical)", "Consumables", "Rent", "Equipment maintenance", "Insurance billing"],
  education: ["Salaries (faculty)", "Rent", "Books & materials", "Marketing", "Software / LMS"],
  marketing: ["Salaries", "Ad spend pass-through", "Software subscriptions", "Freelancers", "Office rent"],
  agency: ["Salaries", "Freelancers", "Software tools", "Office rent", "Production cost"],
  realestate: ["Salaries / commissions", "Marketing listings", "Office rent", "Software (CRM)"],
  logistics: ["Fuel", "Driver salaries", "Vehicle maintenance", "Warehousing", "Tolls & customs"],
};

const GENERIC_REVENUE = ["Product sales", "Service revenue", "Subscriptions", "Consulting / retainers", "Project fees"];
const GENERIC_EXPENSES = ["Salaries", "Rent", "Marketing", "Software & subscriptions", "Utilities", "Travel", "Bank charges"];

function industryOptions(industry: string | null | undefined): { revenue: string[]; expenses: string[] } {
  const key = (industry ?? "").toLowerCase().trim();
  if (!key) return { revenue: GENERIC_REVENUE, expenses: GENERIC_EXPENSES };
  for (const [bucket, opts] of Object.entries(REVENUE_BY_INDUSTRY)) {
    if (key.includes(bucket)) return { revenue: opts, expenses: EXPENSE_BY_INDUSTRY[bucket] ?? GENERIC_EXPENSES };
  }
  return { revenue: GENERIC_REVENUE, expenses: GENERIC_EXPENSES };
}

function buildDefaultFields(industry: string | null | undefined): IntakeField[] {
  const { revenue, expenses } = industryOptions(industry);
  return [
    { key: "owner_name",        label: "Primary contact (owner / founder)", kind: "text", hint: "Full name." },
    { key: "primary_email",     label: "Best email for accounting matters", kind: "text" },
    { key: "phone",             label: "Phone (WhatsApp preferred)",         kind: "text" },
    { key: "business_description", label: "Describe your business in 1–2 sentences", kind: "longtext", hint: "What do you sell, and who's the customer?" },
    { key: "revenue",           label: "Main ways you earn revenue",          kind: "chips", hint: "Tap a suggestion or type your own and press Enter.", options: revenue },
    { key: "expenses",          label: "Biggest cost categories",             kind: "chips", hint: "Tap a suggestion or type your own.", options: expenses },
    { key: "banks",             label: "Banks you use",                       kind: "chips", hint: "Pick from the UAE bank list or type and press Enter.", options: UAE_BANKS },
    { key: "gateways",          label: "Payment gateways",                    kind: "chips", options: ["Stripe", "Telr", "Network", "Tabby", "Tamara", "PayPal", "Other"] },
    { key: "acctSw",            label: "Accounting software currently in use", kind: "chips", options: ["Zoho Books", "QuickBooks", "Xero", "Odoo", "Tally", "Wafeq", "None", "Other"] },
    { key: "employees",         label: "Employees (approx headcount)",         kind: "text" },
    { key: "pain_points",       label: "Biggest pain points you want us to solve", kind: "longtext" },
    { key: "documents",         label: "Upload any documents we should have",      kind: "file", hint: "Trade Licence, MOA, latest bank statement, owner ID, etc. PDFs, images, Excel — all accepted." },
  ];
}

async function resolveIntakeToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("magic_links")
    .select("id,client_id,run_id,org_id,expires_at,purpose")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  if (data.purpose && data.purpose !== "intake" && data.purpose !== "portal") return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

export async function getPublicIntake(token: string): Promise<{ error?: string; data?: PublicIntakeData }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "This link is invalid or has expired. Ask your accountant to send a new one." };
  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("name,primary_contact_email,owner_name,industry")
    .eq("id", link.client_id)
    .maybeSingle();
  // Fields are configured by the team via the dispatch step (run_items kind='intake_config').
  // Fall back to the default set if the team hasn't customised them yet.
  const { data: cfg } = await admin
    .from("run_items")
    .select("data")
    .eq("run_id", link.run_id)
    .eq("kind", "intake_config")
    .maybeSingle();
  const cfgRaw = (cfg?.data as { fields?: IntakeField[] } | null)?.fields;
  const fields = cfgRaw?.length ? cfgRaw : buildDefaultFields(client?.industry as string | null);
  const { data: form } = await admin
    .from("intake_forms")
    .select("submitted,submitted_at")
    .eq("run_id", link.run_id)
    .maybeSingle();
  const stored = (form?.submitted as Record<string, unknown> | null) ?? {};
  // Prefill primary contact + email from what we already know — only if the
  // client hasn't filled the field yet. Saves them re-typing it.
  const prefilledAnswers: Record<string, unknown> = { ...stored };
  const ownerName = (client?.owner_name as string | null)?.trim();
  const email = (client?.primary_contact_email as string | null)?.trim();
  if (ownerName && !((stored.owner_name as string | undefined)?.trim())) prefilledAnswers.owner_name = ownerName;
  if (email && !((stored.primary_email as string | undefined)?.trim())) prefilledAnswers.primary_email = email;
  return {
    data: {
      clientName: client?.name ?? "Your company",
      companyEmail: email ?? null,
      fields,
      answers: prefilledAnswers,
      submittedAt: (form?.submitted_at as string | null) ?? null,
    },
  };
}

/**
 * Autosave a single intake field. Called on blur / debounced change from the
 * public intake page — no auth, just token validation.
 */
export async function savePublicIntakeField(
  token: string,
  key: string,
  value: unknown,
): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "Link invalid or expired." };
  if (!key || typeof key !== "string") return { error: "Bad field." };
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("intake_forms")
    .select("submitted,status")
    .eq("run_id", link.run_id)
    .maybeSingle();
  const merged = { ...((existing?.submitted as Record<string, unknown> | null) ?? {}), [key]: value };
  const { error } = await admin.from("intake_forms").upsert(
    {
      run_id: link.run_id,
      client_id: link.client_id,
      submitted: merged,
      status: existing?.status === "submitted" ? "submitted" : "in_progress",
    },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };
  // Mirror the well-known fields onto the client record so the team's playbook stays in sync.
  const patch: Record<string, unknown> = {};
  if (key === "owner_name" && typeof value === "string") patch.owner_name = value.trim() || null;
  if (key === "primary_email" && typeof value === "string") patch.primary_contact_email = value.trim() || null;
  if (key === "business_description" && typeof value === "string") patch.business_description = value;
  if (key === "pain_points" && typeof value === "string") patch.pain_points = value;
  if (key === "revenue" && Array.isArray(value)) patch.revenue_channels = (value as unknown[]).map((x) => String(x).trim()).filter(Boolean);
  if (key === "banks" && Array.isArray(value)) patch.bank_names = (value as unknown[]).map((x) => String(x).trim()).filter(Boolean);
  if (key === "gateways" && Array.isArray(value)) patch.payment_gateways = (value as unknown[]).map((x) => String(x).trim()).filter(Boolean);
  if (key === "acctSw" && Array.isArray(value)) patch.accounting_software = (value as unknown[]).map((x) => String(x).trim()).filter(Boolean).join(", ");
  if (Object.keys(patch).length) await admin.from("clients").update(patch).eq("id", link.client_id);
  revalidatePath(`/intake/${token}`);
  return { ok: true };
}

/**
 * Step 1 of a file upload: ask the server for a SIGNED upload URL so the
 * browser can stream the bytes straight to Supabase Storage. Bypasses the
 * Server Action body-size limit (~4.5 MB on Vercel). Returns the
 * destination storage path and the one-shot signed URL.
 */
export async function createIntakeFileUploadUrl(
  token: string,
  fieldKey: string,
  filename: string,
): Promise<{ error?: string; uploadUrl?: string; storagePath?: string; token?: string }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "Link invalid or expired." };
  if (!fieldKey || !filename) return { error: "Missing field key or filename." };
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const storagePath = `intake/${link.run_id}/${fieldKey}/${Date.now()}-${safe}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("client-docs").createSignedUploadUrl(storagePath);
  if (error || !data) return { error: error?.message ?? "Couldn't prepare the upload." };
  return { uploadUrl: data.signedUrl, storagePath: data.path, token: data.token };
}

/**
 * Step 2: once the browser finishes uploading to the signed URL, record the
 * file against the intake answer (appended to the field's array of
 * IntakeFileRef). Best-effort copies the file into the client's Drive
 * folder as well — but Storage stays the source of truth.
 */
export async function finalizeIntakeFile(
  token: string,
  fieldKey: string,
  ref: { name: string; storagePath: string; size: number },
): Promise<{ error?: string; ok?: boolean; files?: IntakeFileRef[] }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "Link invalid or expired." };
  if (!fieldKey || !ref?.storagePath) return { error: "Missing field or file." };
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("intake_forms")
    .select("submitted,status")
    .eq("run_id", link.run_id)
    .maybeSingle();
  const submitted = ((existing?.submitted as Record<string, unknown> | null) ?? {});
  const current = Array.isArray(submitted[fieldKey]) ? (submitted[fieldKey] as IntakeFileRef[]) : [];
  const next: IntakeFileRef[] = [
    ...current.filter((f) => f.storagePath !== ref.storagePath),
    { name: ref.name, storagePath: ref.storagePath, size: ref.size, uploadedAt: new Date().toISOString() },
  ];
  const merged = { ...submitted, [fieldKey]: next };
  const { error } = await admin.from("intake_forms").upsert(
    {
      run_id: link.run_id,
      client_id: link.client_id,
      submitted: merged,
      status: existing?.status === "submitted" ? "submitted" : "in_progress",
    },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };

  // Also create a documents row so the team's "Received documents" view picks
  // it up. storage_path embeds a timestamp so collisions are impossible —
  // a plain insert is safe.
  await admin.from("documents").insert({
    org_id: link.org_id,
    run_id: link.run_id,
    client_id: link.client_id,
    label: ref.name,
    storage_path: ref.storagePath,
    who: "client",
    status: "uploaded",
    received_at: new Date().toISOString(),
  });

  await admin.from("notifications").insert({
    org_id: link.org_id,
    run_id: link.run_id,
    kind: "info",
    title: "Client uploaded a document",
    body: ref.name,
  });
  revalidatePath(`/intake/${token}`);
  return { ok: true, files: next };
}

/** Remove an uploaded file (intake form). Storage path is deleted too. */
export async function removeIntakeFile(
  token: string,
  fieldKey: string,
  storagePath: string,
): Promise<{ error?: string; ok?: boolean; files?: IntakeFileRef[] }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("intake_forms")
    .select("submitted")
    .eq("run_id", link.run_id)
    .maybeSingle();
  const submitted = ((existing?.submitted as Record<string, unknown> | null) ?? {});
  const current = Array.isArray(submitted[fieldKey]) ? (submitted[fieldKey] as IntakeFileRef[]) : [];
  const next = current.filter((f) => f.storagePath !== storagePath);
  const merged = { ...submitted, [fieldKey]: next };
  await admin.from("intake_forms").upsert(
    { run_id: link.run_id, client_id: link.client_id, submitted: merged },
    { onConflict: "run_id" },
  );
  await admin.storage.from("client-docs").remove([storagePath]).catch(() => null);
  await admin.from("documents").delete().eq("storage_path", storagePath);
  revalidatePath(`/intake/${token}`);
  return { ok: true, files: next };
}

/**
 * Final submit — flips the status so the team sees "Submitted". Autosave already
 * persists the data field-by-field, so this is just a confirmation marker.
 */
export async function submitPublicIntake(token: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolveIntakeToken(token);
  if (!link) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  await admin
    .from("intake_forms")
    .upsert(
      {
        run_id: link.run_id,
        client_id: link.client_id,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "run_id" },
    );
  // Pull the run's AM + client name so the notification is targeted + meaningful.
  const [{ data: run }, { data: client }] = await Promise.all([
    admin.from("onboarding_runs").select("am_id,template_key").eq("id", link.run_id).maybeSingle(),
    admin.from("clients").select("name").eq("id", link.client_id).maybeSingle(),
  ]);
  const clientName = client?.name ?? "Client";
  const isStandalone = run?.template_key === "lead-intake";
  await admin.from("notifications").insert({
    org_id: link.org_id,
    run_id: link.run_id,
    recipient_id: run?.am_id ?? null,
    kind: "info",
    title: `${clientName} submitted their intake form`,
    body: isStandalone
      ? "Lead intake completed — review the answers and promote to onboarding when ready."
      : "The intake form was completed.",
  });
  await admin.from("clients").update({ profile_complete: true }).eq("id", link.client_id);
  revalidatePath(`/intake/${token}`);
  return { ok: true };
}
