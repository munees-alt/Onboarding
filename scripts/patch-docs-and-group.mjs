/**
 * Patch script:
 * 1. Mark documents as uploaded using `label` column (not `name`)
 * 2. Update GET + MESA client records (team members + docs + core fields)
 *
 * Run: node --env-file=.env.local scripts/patch-docs-and-group.mjs
 */
import { createClient } from '@supabase/supabase-js';

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getOrgId() {
  const { data } = await s.from('orgs').select('id').single();
  return data.id;
}

async function markDocsReceived(clientId, receivedDocLabels) {
  for (const label of receivedDocLabels) {
    const { error } = await s
      .from('documents')
      .update({ status: 'uploaded', received_outside_portal: true })
      .eq('client_id', clientId)
      .ilike('label', `%${label}%`)
      .neq('status', 'not_needed');
    if (error) console.error(`  ✗ doc '${label}':`, error.message);
    else console.log(`  ✓ marked: ${label}`);
  }
}

async function upsertTeamMembers(orgId, clientId, members) {
  const { data: existing } = await s
    .from('client_team_members')
    .select('name')
    .eq('client_id', clientId);
  const existingNames = new Set((existing || []).map(r => r.name.toLowerCase()));

  const toInsert = members
    .filter(m => !existingNames.has(m.name.toLowerCase()))
    .map((m, i) => ({ ...m, org_id: orgId, client_id: clientId, sort_order: i }));

  if (!toInsert.length) { console.log('  ✓ team members already present'); return; }
  const { error } = await s.from('client_team_members').insert(toInsert);
  if (error) console.error('  ✗ team_members:', error.message);
  else console.log(`  ✓ inserted ${toInsert.length} team members`);
}

async function updateClient(clientId, patch) {
  const { error } = await s.from('clients').update(patch).eq('id', clientId);
  if (error) console.error('  ✗ client update:', error.message);
  else console.log('  ✓ client fields updated');
}

// ── GET client ─────────────────────────────────────────────────────────────
const GET_ID = '83122a25-5707-42e0-9c3f-94a5c78e6bfe';
// ── MESA client ────────────────────────────────────────────────────────────
const MESA_ID = 'd61a7daa-eabb-4f4d-8499-de95e745d0b1';

const GET_PATCH = {
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
  business_description: 'Global Equipment Trading (GET) is the legal trading entity in the Plant & Equipment group — takes ownership of machines and pays sellers, hiding seller identity from buyers. Funded by a Zbooni DMCC convertible promissory note of AED 2.5M (Series A-2, 1.5%/mo, issued 8 May 2025) for equipment purchases. Operates from Plot S10516, Jebel Ali. VAT TRN 100397095900003.',
  pain_points: [
    'Inventory segregation — yard holds ~50 machines but only ~10 are GET-owned; rest are consignments; balance sheet must separate owned assets from consignments (inventory module needed)',
    'VAT complexity — application depends on buyer/seller location (mainland vs free zone) and customs status; buyers frequently request no-VAT invoices — case-by-case advice required',
    'Back-to-back deals — MD Saleh handles direct deals (KSA, Iraq, Syria) with advance payments; price changes not always relayed to finance causing AR/AP discrepancies',
    'Dual invoicing — PA invoice (machine + 5% commission) vs GET tax invoice must reconcile cleanly',
  ],
  call_link: 'https://fathom.video/share/ZJijamsVX1os8omEzHuasGxRy-StC-4B',
  call_summary: 'Group onboarding call 26 Jun 2026 — GET is the legal trading arm; inventory segregation (owned vs consignment) and VAT on machine transfers are key issues.',
  call_insights: {
    sections: [
      { heading: 'Role in Group', body: 'GET legally owns and sells machines. This structure hides the seller\'s identity from the buyer. All "make-offer" direct sales route through GET.' },
      { heading: 'Financing', body: 'Zbooni DMCC convertible note AED 2.5M (Series A-2, 1.5%/mo, issued 8 May 2025) — proceeds fund equipment purchases.' },
      { heading: 'VAT', body: 'TRN 100397095900003 (effective 01/01/2018). Quarterly filings: Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar.' },
      { heading: 'Inventory', body: '~50 machines in yard; only ~10 GET-owned. Rest are consignments — must be segregated on the balance sheet.' },
    ],
  },
};

const MESA_PATCH = {
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
  business_description: 'Middle East Strategic Advertising (MESA) is the media arm of the Plant & Equipment group. Sells Plant & Equipment magazine listings, web banners, EDM campaigns, and native ads to a mostly overseas client base (zero-rated exports) plus some UAE clients (standard-rated). Established 12 Feb 2000. Sells 12-month listing/media contracts — deferred revenue recognition is required.',
  pain_points: [
    'Unearned/deferred revenue — MESA sells 12-month listing/media contracts that must be recognised over the contract period',
    'VAT complexity — mostly zero-rated exports but some standard-rated UAE sales; correct VAT config in Zoho required',
    'Historical cleanup — Zoho has duplicate accounts and historical errors',
  ],
  call_link: 'https://fathom.video/share/ZJijamsVX1os8omEzHuasGxRy-StC-4B',
  call_summary: 'Group onboarding call 26 Jun 2026 — MESA is the media arm; 12-month media contracts require deferred revenue recognition; mostly zero-rated exports.',
  call_insights: {
    sections: [
      { heading: 'Revenue', body: 'Magazine listings, web banners, EDM campaigns, native ads. Mostly zero-rated exports (overseas clients) + some standard-rated UAE sales. 12-month contracts — deferred revenue recognition required.' },
      { heading: 'VAT', body: 'TRN 100256069400003 (effective 01/01/2018). Quarterly. Mostly zero-rated.' },
      { heading: 'Key People', body: 'Sahar Gulaid — Chief Sales Officer. MD: Saleh Hayder Kuba.' },
    ],
  },
};

const GET_TEAM = [
  { name: 'Saleh Hayder Kuba', role_label: 'Managing Director / Owner Representative (USA)', notes: 'EID 784-1987-7657595-8' },
  { name: 'Mohamed Shazin Akhthar', role_label: 'Senior Accountant — primary daily contact' },
  { name: 'Ahsain Fasmy', role_label: 'Junior Accountant' },
];

const MESA_TEAM = [
  { name: 'Saleh Hayder Kuba', role_label: 'Managing Director / Owner Representative (USA)', notes: 'EID 784-1987-7657595-8' },
  { name: 'Sahar Gulaid', role_label: 'Chief Sales Officer (MESA)' },
  { name: 'Mohamed Shazin Akhthar', role_label: 'Senior Accountant — primary daily contact' },
];

// ── Documents fix for ALL clients (using label column) ─────────────────────
const DOC_PATCHES = [
  { clientId: '0b50b66c-5b7b-4375-99c2-8b406e11d814', docs: ['Trade licence', 'MOA', 'EID', 'Passport', 'VAT', 'CT'] },
  { clientId: '4087c8cd-775d-4e6c-bbc5-c1e00b02c8c0', docs: ['Trade licence', 'Articles', 'AOA', 'EID', 'Passport'] },
  { clientId: '430e751b-1c9a-4ec6-9fd1-7e7837852ae2', docs: ['Trade licence', 'MOA', 'AOA', 'Certificate', 'EID', 'Passport'] },
  { clientId: '9463b1ec-6fbc-414b-8f67-606c673454ae', docs: ['Certificate', 'MOA', 'AOA', 'Passport', 'Visa', 'Emirates ID', 'Power of Attorney'] },
  { clientId: '7a44cd33-578e-4ee5-bf1c-b553ca3219a4', docs: ['Trade licence', 'Business licence', 'Certificate', 'MOA', 'AOA', 'Passport', 'Emirates ID'] },
  { clientId: '98bb3809-b820-422f-9ec1-30308c0956a0', docs: ['Trade licence', 'Business licence', 'Share Certificate'] },
  { clientId: '78173411-67a6-4ad5-bc2c-2888809dffd6', docs: ['Trade licence', 'Business licence', 'MOA', 'AOA', 'Emirates ID'] },
  { clientId: 'a3a14bbb-9ee8-467f-9338-e5ee7dece0ee', docs: ['Trade licence', 'Establishment Card', 'Ejari', 'Share Transfer', 'Deed'] },
  { clientId: GET_ID, docs: ['Trade licence', 'VAT', 'Share Certificate', 'Lease', 'Loan'] },
  { clientId: MESA_ID, docs: ['Trade licence', 'VAT', 'Establishment Card', 'Ejari'] },
];

async function main() {
  const orgId = await getOrgId();

  console.log('\n▶ Marking documents received (all clients)...');
  for (const d of DOC_PATCHES) {
    console.log(`  Client ${d.clientId.slice(0,8)}...`);
    await markDocsReceived(d.clientId, d.docs);
  }

  console.log('\n▶ Global Equipment Trading FZE...');
  await updateClient(GET_ID, GET_PATCH);
  await upsertTeamMembers(orgId, GET_ID, GET_TEAM);

  console.log('\n▶ Middle East Strategic Advertising...');
  await updateClient(MESA_ID, MESA_PATCH);
  await upsertTeamMembers(orgId, MESA_ID, MESA_TEAM);

  console.log('\n✅ Patch complete.');
}

main().catch(console.error);
