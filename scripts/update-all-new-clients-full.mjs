/**
 * Full backfill for 7 new onboarded clients + PANDE/MESA/GET group
 * Updates:
 *  - clients: business_description, pain_points, call_link, call_notes, call_summary,
 *             call_insights (sections), accounting_software, bank_names, payment_gateways,
 *             vat_registered, owner_name, phone, industry, entity_type, trade_licence_no,
 *             trade_licence_authority, primary_contact_email
 *  - client_team_members: inserts all client-side people (idempotent by name+client_id)
 *  - client_payment_plans: upserts the plan (billing cycle, amount, currency, start_date)
 *  - client_payment_entries: inserts schedule rows (idempotent by period_label)
 *  - documents table: marks received docs as 'uploaded' where status='pending'
 *
 * Run: node --env-file=.env.local scripts/update-all-new-clients-full.mjs
 */

import { createClient } from '@supabase/supabase-js';

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── helpers ────────────────────────────────────────────────────────────────

async function getOrgId() {
  const { data } = await s.from('orgs').select('id').single();
  return data.id;
}

async function upsertTeamMembers(orgId, clientId, members) {
  // Get existing names to avoid duplicates
  const { data: existing } = await s
    .from('client_team_members')
    .select('name')
    .eq('client_id', clientId);
  const existingNames = new Set((existing || []).map(r => r.name.toLowerCase()));

  const toInsert = members
    .filter(m => !existingNames.has(m.name.toLowerCase()))
    .map((m, i) => ({ ...m, org_id: orgId, client_id: clientId, sort_order: i }));

  if (!toInsert.length) return;
  const { error } = await s.from('client_team_members').insert(toInsert);
  if (error) console.error('  ✗ team_members insert:', error.message);
  else console.log(`  ✓ inserted ${toInsert.length} team members`);
}

async function upsertPaymentPlan(orgId, clientId, plan) {
  const { error } = await s
    .from('client_payment_plans')
    .upsert({ org_id: orgId, client_id: clientId, ...plan }, { onConflict: 'client_id' });
  if (error) console.error('  ✗ payment_plan upsert:', error.message);
  else console.log('  ✓ payment plan upserted');
}

async function insertPaymentEntries(orgId, clientId, entries) {
  const { data: existing } = await s
    .from('client_payment_entries')
    .select('period_label')
    .eq('client_id', clientId);
  const existingLabels = new Set((existing || []).map(r => r.period_label));

  const toInsert = entries
    .filter(e => !existingLabels.has(e.period_label))
    .map(e => ({ org_id: orgId, client_id: clientId, ...e }));

  if (!toInsert.length) { console.log('  ✓ payment entries already present'); return; }
  const { error } = await s.from('client_payment_entries').insert(toInsert);
  if (error) console.error('  ✗ payment_entries insert:', error.message);
  else console.log(`  ✓ inserted ${toInsert.length} payment entries`);
}

async function markDocsReceived(clientId, receivedDocNames) {
  // Mark docs matching the names as uploaded; leave not_needed untouched
  for (const name of receivedDocNames) {
    const { error } = await s
      .from('documents')
      .update({ status: 'uploaded' })
      .eq('client_id', clientId)
      .ilike('name', `%${name}%`)
      .neq('status', 'not_needed');
    if (error) console.error(`  ✗ doc mark '${name}':`, error.message);
  }
  console.log('  ✓ docs marked received');
}

async function updateClient(clientId, patch) {
  const { error } = await s.from('clients').update(patch).eq('id', clientId);
  if (error) console.error('  ✗ client update:', error.message);
  else console.log('  ✓ client core fields updated');
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT DATA
// ════════════════════════════════════════════════════════════════════════════

const CLIENTS = [

  // ──────────────────────────────────────────────────────────────────────────
  // 1. FRESH DAILY BAKERY
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '0b50b66c-5b7b-4375-99c2-8b406e11d814',
    name: 'Fresh Daily Bakery',
    patch: {
      owner_name: 'Bloomingbox shareholders — Tariq Abu Samra (47%), Jaya Kumar Arunasalam (33%), Alain El Tawil (20%)',
      phone: '+971 56 548 0033',
      primary_contact_email: 'fahed@rga-group.com',
      industry: 'Bakery Products Manufacturing (Food Manufacturing)',
      entity_type: 'LLC (Industrial Licence) — Mainland Dubai DET',
      trade_licence_no: '1063565',
      trade_licence_authority: 'Dubai Department of Economy and Tourism (DET) — Industrial Licence',
      vat_registered: 'Yes — TRN: 104152341400003 (effective 01/12/2023); CT TRN: 104152341400001',
      accounting_software: 'ERPNext (migrating to); previously Tally via RGA (Jan–Feb 2026)',
      bank_names: ['Alankard (cash tracking)'],
      payment_gateways: [],
      business_description: 'A 4+ year-old manufacturing bakery in Al Quoz, Dubai, 100% owned by the Bloomingbox shareholders (Tariq Abu Samra 47%, Jaya Kumar Arunasalam 33%, Alain El Tawil 20%). Produces solely for Bloomingbox — one consolidated invoice per month, paid in four weekly instalments. ~95% of suppliers are on credit, paid weekly; cash purchases tracked via an Alankard account. A new delivery-only brand (Talabat/Deliveroo) is launching as a second revenue stream.',
      pain_points: [
        'Mar–May 2026 books not done; VAT return due 28 June — urgent catch-up',
        '2025 books need finalisation + audit for a clean baseline (pre-Bloomingbox control)',
        'Jan–Feb 2026 (RGA, on Tally) needs re-reconciliation',
        'Migrating to ERPNext — needs setup help + training',
        'No real-time visibility on sales/COGS/waste',
        'New delivery brand needs analytics beyond standard reports',
        'Needs a 6-week cash-flow budget',
      ],
      call_link: 'https://fathom.video/share/feUF4wYEqqus6qTyq4wzakNbLjUynpvk',
      call_summary: 'Onboarding call 19 Jun 2026 — urgent Mar–May 2026 VAT catch-up; ERPNext migration; new delivery brand launch; 6-week cash-flow budget required.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'ERPNext (target system). Jan–Feb 2026 was managed via RGA on Tally. Cadence should NOT show Zoho Books — that is incorrect.' },
          { heading: 'Revenue Model', body: 'Single customer: Bloomingbox. One consolidated monthly invoice, paid in 4 weekly instalments. New delivery-only brand (Talabat/Deliveroo) launching as a second stream.' },
          { heading: 'Suppliers & Cash', body: '~95% of suppliers on credit, paid weekly. Cash purchases tracked via Alankard account. No formal bank statement yet — bank-statements folder exists.' },
          { heading: 'VAT & Corporate Tax', body: 'VAT TRN 104152341400003 (effective 01/12/2023); CT TRN 104152341400001. VAT quarterly — Mar–May 2026 return due 28 Jun 2026; next Jun–Aug due 28 Sep 2026.' },
          { heading: 'Shareholder Structure', body: 'Ownership transferred in 2024/2026 via MOA share sale. Now: Tariq Abu Samra 47% (Jordan), Jaya Kumar Arunasalam 33% (Malaysia, Golden Visa), Alain El Tawil 20% (Lebanon). Managers: Gerard El Tawil & Majdi Walid Atallah.' },
          { heading: 'Catch-up Scope', body: 'Jan–Feb 2026 (Tally/RGA) re-reconciliation. Mar–May 2026 books completion — urgent for VAT. 2025 books finalisation for audit baseline.' },
          { heading: 'Next Steps', body: 'Obtain renewed trade licence (2024 copy on file — expired). Confirm client email (fahed@rga-group.com is sister company RGA). Build 6-week cash-flow budget. Setup ERPNext.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Ahmad Al Zuraiki', role_label: 'Operating Partner (Conventures) / Decision Maker' },
      { name: 'Nisleen', role_label: 'Accounting POC (Bloomingbox)' },
      { name: 'Emesha Chathurangani', role_label: 'Operations Supervisor / Procurement' },
      { name: 'Tariq Ayman Hamdi Abu Samra', role_label: 'Shareholder 47% (Jordan)', notes: 'Bloomingbox shareholder' },
      { name: 'Jaya Kumar Arunasalam', role_label: 'Shareholder 33% / Executive Manager (Malaysia, Golden Visa)', notes: 'Bloomingbox shareholder' },
      { name: 'Alain El Tawil', role_label: 'Shareholder 20% (Lebanon)', notes: 'Bloomingbox shareholder' },
      { name: 'Gerard El Tawil', role_label: 'Manager (Lebanon)' },
      { name: 'Majdi Walid Atallah', role_label: 'Manager (Lebanon)' },
    ],
    paymentPlan: {
      billing_cycle: 'monthly',
      amount: 1199.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-1037-v1 (11 Jun 2026). Recurring AED 1,199/mo + VAT = AED 1,258.95. One-time catch-up Jan–May 2026: AED 2,299 + VAT = AED 2,413.95 upfront.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 3672.90, notes: 'Recurring AED 1,258.95 + one-time catch-up AED 2,413.95' },
      { due_date: '2026-07-01', period_label: 'Jul 2026', amount: 1258.95 },
      { due_date: '2026-08-01', period_label: 'Aug 2026', amount: 1258.95 },
      { due_date: '2026-09-01', period_label: 'Sep 2026', amount: 1258.95 },
      { due_date: '2026-10-01', period_label: 'Oct 2026', amount: 1258.95 },
      { due_date: '2026-11-01', period_label: 'Nov 2026', amount: 1258.95 },
    ],
    receivedDocs: ['Trade Licence', 'MOA', 'EID', 'Passport', 'VAT certificate', 'CT certificate'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2. ALTARYON
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '4087c8cd-775d-4e6c-bbc5-c1e00b02c8c0',
    name: 'ALTARYON',
    patch: {
      owner_name: 'Alper Ozbilen (100%)',
      phone: '+971 56 726 6766',
      industry: 'Commodity Trading — Oil, Gas & Petrochemicals; General Trading (metals, grains, raw materials pending)',
      entity_type: 'FZCO (Free Zone Company) — DMCC',
      trade_licence_no: 'DMCC-1021258',
      trade_licence_authority: 'DMCC (Dubai Multi Commodities Centre)',
      vat_registered: 'No — not registered; plan to register at voluntary AED 187.5k threshold',
      accounting_software: 'Zoho Books (Finanshels-managed; AED 90/mo + VAT)',
      bank_names: ['FAB', 'ADIB (opening)'],
      payment_gateways: [],
      business_description: 'A DMCC free-zone commodity-trading company established April 2026, focused on oil, gas and petrochemicals, with a general-trading licence application pending to expand into metals, grains and raw materials. 100% owned by Alper Ozbilen. No trading operations have started — current activity is limited to capital transfers and salary payments. A key tax matter: the planned AED 100k/mo shareholder salary exceeds the FTA AED 40k/mo deductible default, so the interim plan is AED 40k salary + AED 60k dividend, pending a benchmarking report.',
      pain_points: [
        'Shareholder salary structuring — needs benchmarking report to deduct full AED 100k/mo; interim AED 40k salary + AED 60k dividend for 2026',
        'Corporate Tax registration outstanding (in progress)',
        'VAT registration timing — register at voluntary threshold ahead of mandatory',
        'New entity — books, software and chart of accounts to be set up from scratch',
        'Wants automated data sharing (view-only bank + PEMO) to avoid manual document requests',
      ],
      call_link: 'https://fathom.video/share/61sxmGN9G9pqEfh4FLsyeFY8-CY2bJ7z',
      call_summary: 'Onboarding call 19 Jun 2026 — pre-revenue DMCC entity; CT registration in progress; shareholder salary structuring (AED 40k safe-harbour + AED 60k dividend for 2026); Zoho Books setup; FAB + ADIB view-only access.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books — Finanshels-managed, AED 90/mo + VAT. One-month free trial active.' },
          { heading: 'Banking', body: 'FAB (existing). ADIB second account opening. View-only access to be granted to Finanshels.' },
          { heading: 'Expense Management', body: 'PEMO app — view-only access to Finanshels.' },
          { heading: 'VAT & Corporate Tax', body: 'Not VAT registered. Plan to register at voluntary AED 187.5k threshold. CT registration in progress — Finanshels filing. First period May 2026–31 Dec 2026; return due 30 Sep 2027. SBR exempt if revenue < AED 3M in 2026.' },
          { heading: 'Shareholder Salary', body: 'Alper plans AED 100k/mo salary. FTA default allows AED 40k/mo deductible. Interim structure: AED 40k salary + AED 60k dividend. A salary-benchmarking report will be needed to justify full AED 100k for 2027+.' },
          { heading: 'Operations', body: 'Pre-revenue. Only capital transfers and salary payments so far. General-trading licence amendment pending to add metals, grains, raw materials.' },
          { heading: 'Team Access', body: 'Zeynep Gurkas (MD), Ana and Muhammed (Business Development) are named. Finanshels team: Jasmeet Singh Monga (GM), Mukesh Vaidya (Team Lead/reviewer), Hritheesh (primary accountant).' },
        ],
      },
    },
    teamMembers: [
      { name: 'Alper Ozbilen', role_label: 'Owner / Sole Shareholder 100% (Turkey)', email: '', notes: 'EID 784-1980-3949056-4' },
      { name: 'Zeynep Gurkas', role_label: 'Managing Director / Company Manager' },
      { name: 'Ana', role_label: 'Business Development' },
      { name: 'Muhammed', role_label: 'Business Development' },
    ],
    paymentPlan: {
      billing_cycle: 'annual',
      amount: 24000.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-0832 (03 Jun 2026). Annual AED 24,000 + VAT = AED 25,200. One-time audit services AED 5,000 + VAT = AED 5,250 upfront. Next renewal Jun 2027.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 30450.00, notes: 'Annual recurring AED 25,200 + one-time audit AED 5,250' },
      { due_date: '2027-06-01', period_label: 'Jun 2027', amount: 25200.00, notes: 'Annual renewal' },
    ],
    receivedDocs: ['Trade Licence', 'Articles of Association', 'AOA', 'EID', 'Passport'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3. TRINOVATE TECHNOLOGIES
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '430e751b-1c9a-4ec6-9fd1-7e7837852ae2',
    name: 'Trinovate',
    patch: {
      owner_name: 'Marc Chamly (60%) & Nassib Sawaya (40%)',
      industry: 'Technology — Device-integrated hardware + SaaS startup (software design & trading, general trading)',
      entity_type: 'FZCO (Free Zone Company) — IFZA, Dubai Silicon Oasis',
      trade_licence_no: '87882',
      trade_licence_authority: 'IFZA — Dubai Integrated Economic Zones Authority (DIEZA), Dubai Silicon Oasis',
      vat_registered: 'No — not registered; mandatory threshold AED 375k',
      accounting_software: 'Zoho Books (Finanshels-managed; AED 90/mo + VAT, multi-currency)',
      bank_names: ['WIO (AED)'],
      payment_gateways: [],
      business_description: 'A tech startup incorporated in IFZA on 4 May 2026, building a device-integrated hardware + SaaS solution at MVP/POC stage. Revenue model: future hardware sales plus a SaaS subscription. Currently pre-revenue, with spend limited to admin and vendor costs for MVP development; many early costs were paid personally by the founders before the WIO bank account was active. Co-founded by Marc Chamly (60%) and Nassib Sawaya (40%).',
      pain_points: [
        'Urgent Corporate Tax registration by 2 Aug 2026 (90-day post-incorporation deadline)',
        'Early expenses paid personally by founders (invoices in founders\' names) — needs reimbursement process + audit trail to capture costs for loss carry-forward',
        'Multi-currency vendor payments (USD/EUR/INR) — needs Zoho multi-currency setup and a USD bank account',
        'Pre-revenue startup — books and chart of accounts to be built from scratch',
        'Wants a clear quarterly reporting cadence',
      ],
      call_link: 'https://fathom.video/share/U4siCmNVf66393pJvGRkt8qBNk7ku3hs',
      call_summary: 'Onboarding call 19 Jun 2026 — IFZA tech startup, pre-revenue MVP/POC stage; urgent CT registration by 2 Aug 2026; founder expense reimbursement process; multi-currency Zoho Books setup; USD account planned.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books — Finanshels-managed, AED 90/mo + VAT, multi-currency plan (USD/EUR/INR).' },
          { heading: 'Banking', body: 'WIO (AED only). USD account planned for vendor payments.' },
          { heading: 'Corporate Tax', body: 'Not yet registered. Deadline 2 Aug 2026 (90 days post-incorporation 4 May 2026). Finanshels to file. SBR exempt 2026 if revenue < AED 3M.' },
          { heading: 'Shareholder Structure', body: 'Marc Chamly 60% (AED 18,000; France; EID 784-1988-8303585-3, Golden Visa). Nassib Sawaya 40% (AED 12,000; Canada; passport PE520464). Share capital AED 30,000 (3,000 shares @ AED 10).' },
          { heading: 'Founder Expenses', body: 'Many pre-WIO costs paid personally by founders. Need a reimbursement process + proper audit trail to capitalise these for loss carry-forward.' },
          { heading: 'Finanshels Team', body: 'Pratheeksha — primary accountant; Mukesh — team lead/reviewer; Jasmeet — GM.' },
          { heading: 'Reporting Cadence', body: 'Wants quarterly reporting cadence. Books to be built from scratch with proper COA.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Marc Chamly', role_label: 'Co-founder, Director & General Manager, 60% (France)', notes: 'EID 784-1988-8303585-3, Golden Visa' },
      { name: 'Nassib Sawaya', role_label: 'Co-founder, Director & Company Secretary, 40% (Canada)', notes: 'Passport PE520464' },
    ],
    paymentPlan: {
      billing_cycle: 'annual',
      amount: 4000.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-1057 (11 Jun 2026). List AED 6,829/yr less referral promo AED 2,829 = AED 4,000 net + VAT AED 200 = AED 4,200/yr. Next renewal Jun 2027.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 4200.00, notes: 'Annual — AED 4,000 + VAT AED 200 (referral promo applied)' },
      { due_date: '2027-06-01', period_label: 'Jun 2027', amount: 4200.00, notes: 'Annual renewal' },
    ],
    receivedDocs: ['Trade Licence', 'MOA', 'AOA', 'Certificate of Formation', 'EID', 'Passport', 'e-visa'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. STREAM FREIGHT
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '9463b1ec-6fbc-414b-8f67-606c673454ae',
    name: 'Stream Freight',
    patch: {
      owner_name: 'Ivalena Dragostinova Mihaylova Djahova (100%)',
      phone: '+971 50 538 8994',
      primary_contact_email: 'ivalena.m@stream-freight.com',
      industry: 'Freight Forwarding / Logistics — Cross-trade services',
      entity_type: 'LLC-FZ (Free Zone LLC) — Meydan Free Zone',
      trade_licence_no: '2542907',
      trade_licence_authority: 'Meydan Free Zone (Meydan City Corporation)',
      vat_registered: 'No — approaching AED 375k threshold (~AED 240k YTD); must register within 30 days of crossing',
      accounting_software: 'Zoho Books (Professional plan, multi-currency; WIO bank-feed integration)',
      bank_names: ['WIO Bank (AED)'],
      payment_gateways: [],
      business_description: 'A Meydan free-zone freight-forwarding company (cross-trade services) established December 2025. Revenue is ~AED 240k YTD and approaching the AED 375k VAT threshold, with June expected to be the strongest month. 100% owned by Ivalena Djahova; her husband Slavey Iordanov Djahov manages operations under a Power of Attorney. AED-only WIO account active since Jan 2026; invoicing moving from a basic template to Zoho Books Professional. Free-zone company with no employees — WPS/payroll does not apply.',
      pain_points: [
        'VAT registration imminent — ~AED 240k revenue nearing AED 375k mandatory threshold; must register within 30 days of crossing',
        'Moving from basic invoice template to Zoho Books (Professional, multi-currency) — setup + training needed',
        'Prior-period catch-up (Jan–May 2026) and books cleanup required',
        'First CT return (Dec 2025–Dec 2026) due 30 Sep 2027',
        'Needs multi-currency invoicing and automated WIO bank feed',
      ],
      call_link: 'https://fathom.video/share/tHFX75_xZvAFT6FBCLtwHL5WGsNwZkFR',
      call_summary: 'Onboarding call 22 Jun 2026 — Meydan FZ freight company, ~AED 240k YTD revenue approaching VAT threshold; Jan–May 2026 catch-up; Zoho Books Professional + WIO bank feed; Slavey Djahov is operational POC via POA.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books Professional plan with multi-currency support. WIO bank feed integration to be set up.' },
          { heading: 'Banking', body: 'WIO Bank (AED only), active since January 2026.' },
          { heading: 'VAT Status', body: 'Not registered. Revenue ~AED 240k YTD; must register within 30 days of crossing AED 375k. June expected to be strongest month.' },
          { heading: 'Corporate Tax', body: 'First period 26 Dec 2025–31 Dec 2026. First return due 30 Sep 2027. SBR exempt if revenue < AED 3M.' },
          { heading: 'Operations', body: 'Cross-trade freight services. No employees — WPS/payroll not applicable. Ivalena is owner; Slavey Djahov (husband) manages operations via POA.' },
          { heading: 'Catch-up Scope', body: 'Jan–May 2026 prior-period catch-up and books cleanup required.' },
          { heading: 'Finanshels Team', body: 'Shahil — primary accountant/POC; Syed — team lead/reviewer; Jasmeet — accounting manager.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Ivalena Dragostinova Mihaylova Djahova', role_label: 'Owner / Sole Shareholder & Director 100% (Bulgaria)', notes: 'EID 784-1977-2984796-8' },
      { name: 'Slavey Iordanov Djahov', role_label: 'Operations Manager / Attorney-in-Fact (POA holder)', notes: 'Husband of owner; primary operational contact' },
    ],
    paymentPlan: {
      billing_cycle: 'monthly',
      amount: 1600.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-1196 (18 Jun 2026). Recurring AED 1,600/mo + VAT = AED 1,680/mo. One-time catch-up Jan–May 2026: AED 3,000 + VAT = AED 3,150 upfront.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 4830.00, notes: 'Recurring AED 1,680 + one-time catch-up AED 3,150' },
      { due_date: '2026-07-01', period_label: 'Jul 2026', amount: 1680.00 },
      { due_date: '2026-08-01', period_label: 'Aug 2026', amount: 1680.00 },
      { due_date: '2026-09-01', period_label: 'Sep 2026', amount: 1680.00 },
      { due_date: '2026-10-01', period_label: 'Oct 2026', amount: 1680.00 },
      { due_date: '2026-11-01', period_label: 'Nov 2026', amount: 1680.00 },
    ],
    receivedDocs: ['Certificate of Formation', 'MOA', 'AOA', 'Passport', 'Visa', 'Emirates ID', 'Power of Attorney'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ALHUSSEIN GROUP FZE
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '7a44cd33-578e-4ee5-bf1c-b553ca3219a4',
    name: 'Alhussein Group',
    patch: {
      owner_name: 'Aden Abdulgadir Hussein (100%)',
      primary_contact_email: 'adenhussein9611@gmail.com',
      industry: 'Multi-activity holding group — Music Consultancy, Cyber Security, IT & Marketing Consultancy, Project Management, General Trading',
      entity_type: 'FZE (Free Zone Establishment) — Sharjah Publishing City Free Zone (SPCFZ)',
      trade_licence_no: '4430120.01',
      trade_licence_authority: 'Sharjah Publishing City Free Zone (SPCFZ)',
      vat_registered: 'No — not registered; register within 30 days of crossing AED 375k',
      accounting_software: 'Zoho Books (client-paid, from AED 60/mo; 1-month free trial)',
      bank_names: [],
      payment_gateways: [],
      business_description: 'A Sharjah Publishing City free-zone establishment formed June 2026 as a holding vehicle to centralise revenue across several activities: an existing music consultancy (Sweden), a new security company launching shortly (Nairobi), and future import-export operations (Somalia/Africa). Licence covers cyber security, IT/marketing consultancy, project management and general trading. 100% owned and managed by Aden Abdulgadir Hussein (Swedish national on a UAE investor visa). Bank account still pending; engagement starts 1 July 2026.',
      pain_points: [
        'Corporate Tax registration is the top priority (penalty risk if delayed)',
        'Company bank account still pending',
        'VAT registration needed once sales cross AED 375k (within 30 days)',
        'Multiple cross-border revenue streams (Sweden, Kenya, Somalia) to consolidate into one entity',
        'Owner salary vs dividend structuring (AED 40k safe-harbour; benchmarking needed for higher)',
        'Transaction volume capped at 150/month — contract revision needed if exceeded',
      ],
      call_link: 'https://fathom.video/share/TH_trzx64y97ydkB_yvEwia8kxY1vkNp',
      call_summary: 'Onboarding call 23 Jun 2026 — SPCFZ holding entity, multiple cross-border revenue streams (music Sweden, security Kenya, import-export Somalia); CT registration top priority; bank account pending; engagement starts 1 Jul 2026.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books — client-paid, from AED 60/mo. One-month free trial.' },
          { heading: 'Banking', body: 'Bank account pending — not yet opened.' },
          { heading: 'Revenue Streams', body: 'Music consultancy (Sweden, existing), security company launching (Nairobi), future import-export (Somalia/Africa). Licence also covers cyber security, IT, marketing, project management, general trading.' },
          { heading: 'Corporate Tax', body: 'Registration is top priority. Finanshels to file on receiving docs. First FY 2026; return due 30 Sep 2027. SBR exempt if revenue < AED 3M.' },
          { heading: 'VAT', body: 'Not registered. Register within 30 days of crossing AED 375k.' },
          { heading: 'Salary Structure', body: 'Owner salary vs dividend — AED 40k safe-harbour for 2026. Benchmarking needed to justify higher amounts for 2027.' },
          { heading: 'Contract Cap', body: 'Transaction volume capped at 150/month. If exceeded, contract revision required.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Aden Abdulgadir Hussein', role_label: 'Owner / Sole Shareholder & Manager 100% (Sweden)', notes: 'EID 784-1996-2264982-2; Investor visa; 50 shares @ AED 1,000' },
    ],
    paymentPlan: {
      billing_cycle: 'monthly',
      amount: 1200.00,
      currency: 'AED',
      start_date: '2026-07-01',
      notes: 'PR-2026-1177 (18 Jun 2026). Recurring AED 1,200/mo + VAT = AED 1,260/mo. Contract starts 1 Jul 2026.',
    },
    paymentEntries: [
      { due_date: '2026-07-01', period_label: 'Jul 2026', amount: 1260.00 },
      { due_date: '2026-08-01', period_label: 'Aug 2026', amount: 1260.00 },
      { due_date: '2026-09-01', period_label: 'Sep 2026', amount: 1260.00 },
      { due_date: '2026-10-01', period_label: 'Oct 2026', amount: 1260.00 },
      { due_date: '2026-11-01', period_label: 'Nov 2026', amount: 1260.00 },
      { due_date: '2026-12-01', period_label: 'Dec 2026', amount: 1260.00 },
    ],
    receivedDocs: ['Business Licence', 'Certificate of Formation', 'MOA', 'AOA', 'Passport', 'Emirates ID'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6. EMARGROW FZE LLC
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '98bb3809-b820-422f-9ec1-30308c0956a0',
    name: 'Emargrow',
    patch: {
      owner_name: 'Manal Hussein Saleh Alameri (100% registered); Mohammed Liyakath (co-founder/operator)',
      primary_contact_email: 'manal.alamari66@gmail.com',
      industry: 'Wholesale Fruit & Vegetable / Foodstuff Trading',
      entity_type: 'FZE LLC (Free Zone Entity) — Ajman NuVentures Centre Free Zone (ANC FZ)',
      trade_licence_no: '2625514005888',
      trade_licence_authority: 'Ajman NuVentures Centre Free Zone (ANC FZ)',
      vat_registered: 'Yes — registration in progress; first quarterly period Jun–Aug 2026; return due 28 Sep 2026',
      accounting_software: 'Zoho Books (Finanshels-managed; setup in scope)',
      bank_names: [],
      payment_gateways: [],
      business_description: 'An Ajman NuVentures free-zone wholesale fruit & vegetable trader launched 21 April 2026. Manal Hussein Saleh Alameri is the 100% registered shareholder; Mohammed Liyakath co-founded and operates it. Sources from local UAE markets (import plans paused due to geopolitical risk) and sells solely to one customer, Barakat, to manage early risk. Operational expenses (payroll for 7–8 staff, delivery vehicles) are presently carried by an affiliated textile company and will be invoiced to Emargrow monthly to align costs with revenue.',
      pain_points: [
        'Inter-company expense alignment — textile company pays Emargrow\'s costs (payroll, delivery); needs monthly inter-company invoicing so reports are not distorted',
        'PO process correction — must issue POs before receiving goods (was creating them from supplier invoices)',
        'Single-customer concentration risk (only Barakat)',
        'Wastage tracking — 10–30 kg/day expected in local season; needs a dedicated wastage account',
        'First VAT return (Jun–Aug 2026) due 28 Sep 2026',
        'Same-day invoicing turnaround for Barakat (requests by 4 PM)',
      ],
      call_link: 'https://fathom.video/share/Tox_BqPdCvPEWMWPon6g7qAy46wm-zHL',
      call_summary: 'Onboarding call 24 Jun 2026 — ANC FZ wholesale produce trader; single customer Barakat; inter-company expense invoicing with affiliated textile company; PO process correction; 7–8 staff; VAT registration in progress.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books — Finanshels-managed; setup in scope.' },
          { heading: 'Revenue & Customer', body: 'Sells solely to Barakat. Invoicing must happen same-day, requests by 4 PM. Sources from local UAE markets. Import plans paused due to geopolitical risk.' },
          { heading: 'Expense Structure', body: 'Affiliated textile company currently carries payroll (7–8 staff) and delivery vehicle costs. Monthly inter-company invoice to Emargrow needed to align P&L.' },
          { heading: 'VAT', body: 'Registration in progress. First quarterly period Jun–Aug 2026; return due 28 Sep 2026.' },
          { heading: 'Wastage', body: '10–30 kg/day waste expected in local season. Needs dedicated wastage account in COA.' },
          { heading: 'PO Process', body: 'Currently creating POs from supplier invoices retroactively. Must be corrected: issue PO before receiving goods.' },
          { heading: 'Discount Note', body: 'AED 250 discount applies to first month only (Jun 2026 = AED 996.45 incl. VAT). From Jul 2026 full rate AED 1,258.95 incl. VAT applies. PR-2026-1256-v1.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Manal Hussein Saleh Alameri', role_label: 'Owner / Sole Shareholder & Manager 100% (UAE)', notes: 'Passport AA0504144; 100 shares @ AED 1,000; capital AED 100,000' },
      { name: 'Mohammed Liyakath', role_label: 'Co-founder / Operator', notes: 'Per call — not a registered shareholder' },
    ],
    paymentPlan: {
      billing_cycle: 'monthly',
      amount: 949.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-1256-v1 (22 Jun 2026). AED 1,199 list less AED 250 first-month discount = AED 949 net + VAT AED 47.45 = AED 996.45 for Jun 2026 only. From Jul 2026: full rate AED 1,199 + VAT = AED 1,258.95/mo.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 996.45, notes: 'First month — AED 250 discount applied (one-time)' },
      { due_date: '2026-07-01', period_label: 'Jul 2026', amount: 1258.95 },
      { due_date: '2026-08-01', period_label: 'Aug 2026', amount: 1258.95 },
      { due_date: '2026-09-01', period_label: 'Sep 2026', amount: 1258.95 },
      { due_date: '2026-10-01', period_label: 'Oct 2026', amount: 1258.95 },
      { due_date: '2026-11-01', period_label: 'Nov 2026', amount: 1258.95 },
    ],
    receivedDocs: ['Business Licence', 'Share Certificate'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7. BSK IT CONSULTING FZE
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: '78173411-67a6-4ad5-bc2c-2888809dffd6',
    name: 'BSK IT Consulting',
    patch: {
      owner_name: 'Abdelkader Khouider Adda Bousekrane (100%)',
      industry: 'IT Consulting — IT & Project Management Consultancy, Innovation & AI Research/Consultancy',
      entity_type: 'FZE (Free Zone Establishment) — Sharjah Publishing City Free Zone (SPCFZ)',
      trade_licence_no: '4424114.01',
      trade_licence_authority: 'Sharjah Publishing City Free Zone (SPCFZ)',
      vat_registered: 'No — registration in progress; qualifies for VAT exemption (all sales outside UAE)',
      accounting_software: 'Zoho Books (switching from custom invoice template)',
      bank_names: ['Y.O. Bank (multi-currency)'],
      payment_gateways: [],
      business_description: 'A Sharjah Publishing City free-zone establishment incorporated 12 September 2025, wholly owned and managed by Abdelkader Khouider Adda Bousekrane (French national, UAE resident). Provides IT consulting, project management, and innovation/AI research & consultancy to 100% international clients (e.g. London), invoiced in EUR. Invoicing moving from a custom template to Zoho. Banking via Y.O. Bank (multi-currency). Early-stage with all revenue earned outside the UAE.',
      pain_points: [
        'CT registration overdue (3-month deadline missed) — Finanshels registering now; AED 10k penalty waived if first return filed by 31 Jul 2027',
        'Owner salary > AED 40k/mo justification — use SBR for 2026 (waives benchmarking); 2027+ needs salary benchmarking report or salary + dividend split',
        'VAT exemption certificate application needed (all sales outside UAE) to avoid ongoing VAT filings',
        'Employment contract required between Abdelkader (employee) and BSK (employer) — template to be provided',
        'Catch-up accounting from Sep 2025 (prior-period cleanup)',
        'Trade Licence renewal due Sep 2026',
      ],
      call_link: 'https://fathom.video/share/9B6LmsxXfkk9WtFjYT2APncYb_8KLrBG',
      call_summary: 'Onboarding call 24 Jun 2026 — SPCFZ IT consulting FZE, 100% international clients invoiced in EUR; CT registration overdue (Finanshels registering now); VAT exemption application; Y.O. Bank multi-currency; catch-up from Sep 2025.',
      call_insights: {
        sections: [
          { heading: 'Accounting Software', body: 'Zoho Books — switching from a custom invoice template.' },
          { heading: 'Banking', body: 'Y.O. Bank (multi-currency) — active.' },
          { heading: 'Revenue', body: '100% international clients (e.g. London), invoiced in EUR. All sales outside UAE — qualifies for VAT exemption.' },
          { heading: 'Corporate Tax', body: 'Registration overdue (3-month post-incorporation deadline missed). Finanshels registering immediately. AED 10k penalty waived if first return filed by 31 Jul 2027. Tax period Sep 2025–Dec 2026; return due 30 Sep 2027. SBR applies for 2026.' },
          { heading: 'VAT Exemption', body: 'Application for VAT exemption certificate needed — all sales are outside UAE. This avoids ongoing quarterly VAT filings.' },
          { heading: 'Salary Structure', body: 'Owner salary > AED 40k/mo. For 2026 use SBR (waives benchmarking). From 2027 needs salary benchmarking report to justify full amount, or salary + dividend split.' },
          { heading: 'Employment Contract', body: 'Employment contract required between Abdelkader (as employee) and BSK (as employer). Template to be provided by Finanshels.' },
          { heading: 'Finanshels Team', body: 'Shahil Abdul Nasser — accountant/primary contact; Syed — QC/manager; Jasmeet Singh Monga — GM; Munees KV — onboarding facilitator.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Abdelkader Khouider Adda Bousekrane', role_label: 'Owner / Sole Shareholder & Manager 100% (France)', notes: 'UAE resident; EID 784-1997-1351701-1; passport 18AC66669; DOB 07/10/1997; Investor designation' },
    ],
    paymentPlan: {
      billing_cycle: 'annual',
      amount: 6829.00,
      currency: 'AED',
      start_date: '2026-06-01',
      notes: 'PR-2026-1230 (22 Jun 2026). Annual AED 6,829 + VAT = AED 7,170.45. One-time catch-up Sep 2025–May 2026: AED 1,899 + VAT = AED 1,993.95 upfront. First invoice total: AED 9,164.40. Monthly equivalent ~AED 764. Next renewal Jun 2027.',
    },
    paymentEntries: [
      { due_date: '2026-06-01', period_label: 'Jun 2026', amount: 9164.40, notes: 'Annual AED 7,170.45 + one-time catch-up AED 1,993.95' },
      { due_date: '2027-06-01', period_label: 'Jun 2027', amount: 7170.45, notes: 'Annual renewal' },
    ],
    receivedDocs: ['Business Licence', 'MOA', 'AOA', 'Emirates ID'],
  },

];

// ════════════════════════════════════════════════════════════════════════════
// PANDE / MESA / GET GROUP — 3 separate client records
// These are the group entities. Payment plan pending (no signed proposal found).
// ════════════════════════════════════════════════════════════════════════════

const GROUP_CLIENTS = [
  {
    name: 'PANDE Auctions',
    searchName: 'PANDE',
    patch: {
      owner_name: 'PLANT & EQUIPMENT HOLDING LTD (100%)',
      phone: '+971 50 585 1857',
      primary_contact_email: 'salkuba@gmail.com',
      industry: 'Online Vehicle / Equipment Auctions — auction platform',
      entity_type: 'LLC – Single Owner (Mainland Dubai DET)',
      trade_licence_no: '959985',
      trade_licence_authority: 'Dubai Department of Economy and Tourism (DET)',
      vat_registered: 'Group VAT — confirm TRN (GET/MESA hold VAT registrations)',
      accounting_software: 'Zoho Books (group; health check + VAT config in progress)',
      bank_names: [],
      business_description: 'PANDE Auctions is the neutral auction platform entity within the Plant & Equipment group (owner PLANT & EQUIPMENT HOLDING LTD, MD Saleh Hayder Kuba). Earns commissions (5% buyer, 3–5% seller) plus listing fees ($350/60 days then $350/30 days). The platform hides seller identity from buyers — all legal machine ownership/trading goes through Global Equipment Trading (GET). Originally "Luktah Trading LLC" (22 Jun 2021), renamed PANDE Auctions 8 Mar 2023.',
      pain_points: [
        'Inventory segregation — yard holds ~50 machines but only ~10 are GET-owned; rest are consignments; balance sheet must separate owned assets from consignments (inventory module needed)',
        'VAT complexity — application depends on buyer/seller location (mainland vs free zone) and customs status; buyers frequently request no-VAT invoices — case-by-case advice required',
        'Back-to-back deals — MD Saleh handles direct deals (KSA, Iraq, Syria) with advance payments; price changes not always relayed to finance causing AR/AP discrepancies',
        'Dual invoicing — PA invoice (machine + 5% commission) vs GET tax invoice must reconcile cleanly',
        'Historical cleanup — Zoho has duplicate accounts and historical errors; configure VAT correctly',
        'Unearned/deferred revenue — MESA sells 12-month listing/media contracts that must be recognised over the contract period',
      ],
      call_link: 'https://fathom.video/share/ZJijamsVX1os8omEzHuasGxRy-StC-4B',
      call_summary: 'Onboarding call 26 Jun 2026 — three-entity group (PANDE/MESA/GET) under Plant & Equipment brand; Zoho health check starting Jun 2026; inventory segregation, VAT complexity, dual invoicing, and MESA deferred revenue are key issues.',
      call_insights: {
        sections: [
          { heading: 'Group Structure', body: 'PLANT & EQUIPMENT HOLDING LTD owns all three: PANDE Auctions (auction platform), GET (trading entity that legally owns machines), MESA (media/advertising). Brand front: plantandequipment.com.' },
          { heading: 'PANDE Revenue', body: 'Commissions: 5% buyer + 3–5% seller. Listing fees: $350/60 days then $350/30 days. "Make-offer" direct sales route entirely through GET with no buyer commission.' },
          { heading: 'GET Revenue', body: 'Earns the machine sale price. Owns/sells machines. VAT TRN 100397095900003 (effective 01/01/2018). Zbooni DMCC convertible note AED 2.5M (Series A-2, 1.5%/mo) funds equipment purchases.' },
          { heading: 'MESA Revenue', body: 'Plant & Equipment magazine, web listings, EDM, banners, native ads. VAT TRN 100256069400003. Mostly zero-rated exports (overseas clients) + some standard-rated UAE sales. Sells 12-month contracts — deferred revenue recognition required.' },
          { heading: 'Inventory Issue', body: 'Yard holds ~50 machines; only ~10 are GET-owned. Rest are consignments. Balance sheet must separate owned assets from consignments via inventory module.' },
          { heading: 'Key Contacts', body: 'Mohamed Shazin Akhthar (Shazin) — Senior Accountant, primary daily contact. Ahsain Fasmy — Junior Accountant (AR, payment links, quotations). Sahar Gulaid — CSO (MESA). Mohamed Awny — Auction Sales Manager. Saleh Hayder Kuba — MD for all 3 entities.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Saleh Hayder Kuba', role_label: 'Managing Director / Owner Representative (USA)', notes: 'EID 784-1987-7657595-8; contact: salkuba@gmail.com / +971 50 585 1857' },
      { name: 'Mohamed Shazin Akhthar', role_label: 'Senior Accountant — primary daily contact' },
      { name: 'Ahsain Fasmy', role_label: 'Junior Accountant (AR, payment links, quotations)' },
      { name: 'Sahar Gulaid', role_label: 'Chief Sales Officer (MESA)' },
      { name: 'Mohamed Awny', role_label: 'Auction Sales Manager' },
    ],
    receivedDocs: ['Trade Licence', 'Establishment Card', 'Ejari', 'Share Transfer Deed'],
  },
  {
    name: 'Global Equipment Trading',
    searchName: 'GET',
    patch: {
      owner_name: 'PLANT & EQUIPMENT HOLDING LTD (100%)',
      phone: '+971 50 585 1857',
      primary_contact_email: 'Skuba@plantandequipment.com',
      industry: 'Heavy Equipment & Machinery Trading — Construction equipment, heavy machinery, spare parts, handling/lifting/loading equipment',
      entity_type: 'FZE (Free Zone Establishment) — JAFZA',
      trade_licence_no: '4887',
      trade_licence_authority: 'Jebel Ali Free Zone (JAFZA)',
      vat_registered: 'Yes — TRN: 100397095900003 (effective 01/01/2018); quarterly filings',
      accounting_software: 'Zoho Books (group; health check + VAT config in progress)',
      bank_names: [],
      business_description: 'Global Equipment Trading (GET) is the legal trading entity in the Plant & Equipment group — it takes ownership of machines and pays sellers, hiding the seller identity from buyers. Funded by a Zbooni DMCC convertible promissory note of AED 2.5M (Series A-2, 1.5%/mo, issued 8 May 2025) for equipment purchases. Operates from Plot S10516, Jebel Ali. VAT TRN 100397095900003.',
      call_link: 'https://fathom.video/share/ZJijamsVX1os8omEzHuasGxRy-StC-4B',
      call_summary: 'Group onboarding call 26 Jun 2026 — GET is the trading arm; inventory segregation (owned vs consignment) and VAT on machine transfers are key issues.',
      call_insights: {
        sections: [
          { heading: 'Role in Group', body: 'GET legally owns and sells machines. This structure hides the seller\'s identity from the buyer. All "make-offer" direct sales route through GET.' },
          { heading: 'Financing', body: 'Zbooni DMCC convertible note AED 2.5M (Series A-2, 1.5%/mo, issued 8 May 2025) — proceeds fund equipment purchases.' },
          { heading: 'VAT', body: 'TRN 100397095900003 (effective 01/01/2018). Quarterly filings: Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar.' },
          { heading: 'Inventory', body: '~50 machines in yard; only ~10 GET-owned. Rest are consignments — must be segregated on the balance sheet.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Saleh Hayder Kuba', role_label: 'Managing Director / Owner Representative (USA)', notes: 'EID 784-1987-7657595-8' },
      { name: 'Mohamed Shazin Akhthar', role_label: 'Senior Accountant — primary daily contact' },
      { name: 'Ahsain Fasmy', role_label: 'Junior Accountant' },
    ],
    receivedDocs: ['Trade Licence', 'VAT Registration Certificate', 'Share Certificate', 'Yard Lease', 'Zbooni Loan Note'],
  },
  {
    name: 'Middle East Strategic Advertising',
    searchName: 'MESA',
    patch: {
      owner_name: 'PLANT & EQUIPMENT HOLDING LTD (100%)',
      phone: '+971 4 580 8020',
      primary_contact_email: 'Skuba@plantandequipment.com',
      industry: 'Advertising & Media — Plant & Equipment magazine, marketplace listings, EDM, banners, native ads',
      entity_type: 'LLC – Single Owner (Mainland Dubai DET)',
      trade_licence_no: '516627',
      trade_licence_authority: 'Dubai Department of Economy and Tourism (DET)',
      vat_registered: 'Yes — TRN: 100256069400003 (effective 01/01/2018); quarterly; mostly zero-rated exports',
      accounting_software: 'Zoho Books (group; health check + VAT config in progress)',
      bank_names: [],
      business_description: 'Middle East Strategic Advertising (MESA) is the media arm of the Plant & Equipment group. Sells Plant & Equipment magazine listings, web banners, EDM campaigns, and native ads to a mostly overseas client base (zero-rated exports) plus some UAE clients (standard-rated). Established 12 Feb 2000. Sells 12-month listing/media contracts — deferred revenue recognition is required. VAT TRN 100256069400003.',
      call_link: 'https://fathom.video/share/ZJijamsVX1os8omEzHuasGxRy-StC-4B',
      call_summary: 'Group onboarding call 26 Jun 2026 — MESA is the media arm; 12-month media contracts require deferred revenue recognition; mostly zero-rated exports.',
      call_insights: {
        sections: [
          { heading: 'Revenue', body: 'Magazine listings, web banners, EDM campaigns, native ads. Mostly zero-rated exports (overseas clients) + some standard-rated UAE sales. 12-month contracts — deferred revenue recognition required.' },
          { heading: 'VAT', body: 'TRN 100256069400003 (effective 01/01/2018). Quarterly. Mostly zero-rated.' },
          { heading: 'Key People', body: 'Sahar Gulaid — Chief Sales Officer. MD: Saleh Hayder Kuba.' },
        ],
      },
    },
    teamMembers: [
      { name: 'Saleh Hayder Kuba', role_label: 'Managing Director / Owner Representative (USA)', notes: 'EID 784-1987-7657595-8' },
      { name: 'Sahar Gulaid', role_label: 'Chief Sales Officer (MESA)' },
      { name: 'Mohamed Shazin Akhthar', role_label: 'Senior Accountant — primary daily contact' },
    ],
    receivedDocs: ['Trade Licence', 'VAT Certificate', 'Establishment Card', 'Ejari'],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const orgId = await getOrgId();
  console.log('Org ID:', orgId);

  // ── Process the 7 direct clients ──
  for (const c of CLIENTS) {
    console.log(`\n▶ ${c.name} (${c.id})`);
    await updateClient(c.id, c.patch);
    await upsertTeamMembers(orgId, c.id, c.teamMembers);
    await upsertPaymentPlan(orgId, c.id, c.paymentPlan);
    await insertPaymentEntries(orgId, c.id, c.paymentEntries);
    await markDocsReceived(c.id, c.receivedDocs);
  }

  // ── Process PANDE / MESA / GET — look up by name ──
  console.log('\n▶ Looking up PANDE/MESA/GET group entities by name...');
  for (const gc of GROUP_CLIENTS) {
    const { data: matches } = await s
      .from('clients')
      .select('id, name')
      .ilike('name', `%${gc.searchName}%`)
      .limit(5);

    if (!matches || !matches.length) {
      console.log(`  ✗ No client found matching '${gc.searchName}' — skipping`);
      continue;
    }

    // Pick the best match
    const client = matches[0];
    console.log(`\n  ▶ ${gc.name} → matched '${client.name}' (${client.id})`);
    await updateClient(client.id, gc.patch);
    await upsertTeamMembers(orgId, client.id, gc.teamMembers);
    await markDocsReceived(client.id, gc.receivedDocs);
    // Note: PANDE/MESA/GET payment plan pending — no signed proposal in Drive yet
    console.log('  ⚠ Payment plan not set — attach signed proposal to populate');
  }

  console.log('\n✅ All done.');
}

main().catch(console.error);
