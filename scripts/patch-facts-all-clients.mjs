/**
 * Fills every blank `facts` field + direct columns for all 10 clients.
 * Merges into existing facts (does not overwrite existing values).
 *
 * Run: node --env-file=.env.local scripts/patch-facts-all-clients.mjs
 */
import { createClient } from '@supabase/supabase-js';

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Direct-column patches (non-facts columns)
const DIRECT = [
  {
    id: '0b50b66c-5b7b-4375-99c2-8b406e11d814',
    name: 'Fresh Daily Bakery',
    direct: {
      vat_trn: '104152341400003',
      primary_contact_name: 'Nisleen (Accounting POC, Bloomingbox)',
      revenue_bracket: '~AED 1.5M/year',
    },
    facts: {
      launch_date: 'Operating 4+ years — established May/Jun 2022',
      founder_location: 'Dubai, UAE',
      trade_license_start_date: '17/06/2022',
      financial_year_end: '31 December',
      trade_license_number: '1063565',
      license_expiry: '16/06/2024 (expired — renewed copy needed from client)',
      number_of_branches: '1 — single warehouse, Al Quoz, Dubai',
      free_zone_authority: 'N/A — Mainland (Dubai DET Industrial Licence)',
      company_start_date: '19/05/2022 (commercial register)',
      vat_filing_deadline: 'Quarterly — Mar–May 2026 due 28 Jun 2026; next Jun–Aug due 28 Sep 2026',
      budget: '6-week cash-flow budget to be built (Ahmad requirement)',
      sole_shareholder: 'No — multi-shareholder (Bloomingbox shareholders)',
      trade_license_expiry: '16/06/2024 (expired — renewed copy needed)',
      shareholder_status: 'Multi-shareholder; ownership transferred via 2024/2026 MOA share sale',
      vat_start_date: '01/12/2023',
      incorporation_date: '19/05/2022 (commercial register); licence issued 17/06/2022',
      shareholder_structure: 'Tariq Abu Samra 47% · Jaya Kumar Arunasalam 33% · Alain El Tawil 20% (via Bloomingbox); Managers: Gerard El Tawil & Majdi Walid Atallah',
    },
    reg_facts: {
      incorporationDate: '2022-05-19',
      tradeLicenceExpiry: '2024-06-16',
      vatFirstFiling: '2024-03-28',
    },
  },
  {
    id: '4087c8cd-775d-4e6c-bbc5-c1e00b02c8c0',
    name: 'ALTARYON',
    direct: {
      primary_contact_name: 'Alper Ozbilen (Owner)',
      revenue_bracket: 'Pre-revenue (targeting under AED 3M for 2026 SBR)',
    },
    facts: {
      launch_date: '21 April 2026',
      founder_location: 'UAE',
      trade_license_start_date: '21/04/2026',
      financial_year_end: '31 December',
      trade_license_number: 'DMCC-1021258 (Reg. DMCC204658 · Account 493854)',
      license_expiry: '20/04/2027',
      number_of_branches: '1 — single DMCC unit',
      free_zone_authority: 'DMCC (Dubai Multi Commodities Centre)',
      company_start_date: '21/04/2026',
      vat_filing_deadline: 'N/A until registered (voluntary at AED 187.5k threshold; mandatory at AED 375k)',
      budget: 'Not set — pre-revenue',
      sole_shareholder: 'Yes — Alper Ozbilen (100%)',
      trade_license_expiry: '20/04/2027',
      shareholder_status: 'Single shareholder (100%)',
      vat_start_date: 'Not registered — planned at voluntary AED 187.5k threshold',
      incorporation_date: '21/04/2026 (DMCC registration)',
      shareholder_structure: 'Alper Ozbilen 100%',
    },
    reg_facts: {
      incorporationDate: '2026-04-21',
      tradeLicenceExpiry: '2027-04-20',
    },
  },
  {
    id: '430e751b-1c9a-4ec6-9fd1-7e7837852ae2',
    name: 'Trinovate Technologies',
    direct: {
      primary_contact_name: 'Marc Chamly (Co-founder & Director)',
      revenue_bracket: 'Pre-revenue (MVP/POC stage)',
    },
    facts: {
      launch_date: '04/05/2026',
      founder_location: 'Dubai, UAE',
      trade_license_start_date: '04/05/2026',
      financial_year_end: '31 December',
      trade_license_number: '87882 (Registration No. 81124)',
      license_expiry: '03/05/2027',
      number_of_branches: '1 — single',
      free_zone_authority: 'IFZA — Dubai Integrated Economic Zones Authority (DIEZA), Dubai Silicon Oasis',
      company_start_date: '04/05/2026',
      vat_filing_deadline: 'N/A until registered (mandatory at AED 375k)',
      budget: 'Not set — pre-revenue startup',
      sole_shareholder: 'No — two shareholders (Marc Chamly & Nassib Sawaya)',
      trade_license_expiry: '03/05/2027',
      shareholder_status: 'Two shareholders',
      vat_start_date: 'Not registered',
      incorporation_date: '04/05/2026',
      shareholder_structure: 'Marc Chamly 60% (AED 18,000; France; Golden Visa) · Nassib Sawaya 40% (AED 12,000; Canada); share capital AED 30,000 (3,000 shares @ AED 10)',
    },
    reg_facts: {
      incorporationDate: '2026-05-04',
      tradeLicenceExpiry: '2027-05-03',
    },
  },
  {
    id: '9463b1ec-6fbc-414b-8f67-606c673454ae',
    name: 'Stream Freight',
    direct: {
      primary_contact_name: 'Slavey Iordanov Djahov (Operations Manager / POA)',
      revenue_bracket: '~AED 240k YTD (approaching AED 375k VAT threshold)',
    },
    facts: {
      launch_date: '26/12/2025',
      founder_location: 'Dubai, UAE (Jumeirah Park)',
      trade_license_start_date: '26/12/2025',
      financial_year_end: '31 December',
      trade_license_number: '2542907 (Meydan FZ formation number)',
      license_expiry: 'December 2026 — client\'s responsibility to renew',
      number_of_branches: '1 — single (no employees; WPS/payroll not applicable)',
      free_zone_authority: 'Meydan Free Zone (Meydan City Corporation)',
      company_start_date: '26/12/2025',
      vat_filing_deadline: 'N/A until registered — must register within 30 days of crossing AED 375k',
      budget: 'Not set',
      sole_shareholder: 'Yes — Ivalena Dragostinova Mihaylova Djahova (100%)',
      trade_license_expiry: 'December 2026',
      shareholder_status: 'Single shareholder (100%); operations via POA holder Slavey Djahov',
      vat_start_date: 'Not yet registered',
      incorporation_date: '26/12/2025',
      shareholder_structure: 'Ivalena Dragostinova Mihaylova Djahova 100% (100 shares @ AED 1,000; capital AED 100,000)',
    },
    reg_facts: {
      incorporationDate: '2025-12-26',
      tradeLicenceExpiry: '2026-12-25',
      ctFirstFiling: '2027-09-30',
    },
  },
  {
    id: '7a44cd33-578e-4ee5-bf1c-b553ca3219a4',
    name: 'Alhussein Group FZE',
    direct: {
      primary_contact_name: 'Aden Abdulgadir Hussein (Owner)',
      revenue_bracket: 'Early-stage (targeting under AED 3M for 2026 SBR)',
    },
    facts: {
      launch_date: '08/06/2026',
      founder_location: 'UAE (Swedish national; investor visa)',
      trade_license_start_date: '08/06/2026',
      financial_year_end: '31 December (confirm against AOA)',
      trade_license_number: '4430120.01 (Formation No. 4430120)',
      license_expiry: '07/06/2027',
      number_of_branches: '1 — single',
      free_zone_authority: 'Sharjah Publishing City Free Zone (SPCFZ)',
      company_start_date: '08/06/2026',
      vat_filing_deadline: 'N/A until registered',
      budget: 'Not set',
      sole_shareholder: 'Yes — Aden Abdulgadir Hussein (100%)',
      trade_license_expiry: '07/06/2027',
      shareholder_status: 'Single shareholder (100%)',
      vat_start_date: 'Not registered',
      incorporation_date: '08/06/2026',
      shareholder_structure: 'Aden Abdulgadir Hussein 100% (50 shares @ AED 1,000; capital AED 50,000)',
    },
    reg_facts: {
      incorporationDate: '2026-06-08',
      tradeLicenceExpiry: '2027-06-07',
      ctFirstFiling: '2027-09-30',
    },
  },
  {
    id: '98bb3809-b820-422f-9ec1-30308c0956a0',
    name: 'Emargrow FZE LLC',
    direct: {
      primary_contact_name: 'Mohammed Liyakath (Co-founder/Operator)',
      revenue_bracket: 'Early-stage (sole customer Barakat; under AED 3M)',
    },
    facts: {
      launch_date: '21/04/2026',
      founder_location: 'UAE',
      trade_license_start_date: '21/04/2026',
      financial_year_end: '31 December (confirm against AOA)',
      trade_license_number: '2625514005888',
      license_expiry: '20/04/2027',
      number_of_branches: '1 — single',
      free_zone_authority: 'Ajman NuVentures Centre Free Zone (ANC FZ)',
      company_start_date: '21/04/2026',
      vat_filing_deadline: 'Quarterly — first period Jun–Aug 2026, return due 28 Sep 2026',
      budget: 'Not set — staff/delivery costs currently carried by affiliated textile company',
      sole_shareholder: 'Yes — Manal Hussein Saleh Alameri (registered); Mohammed Liyakath is co-founder/operator (not a registered shareholder)',
      trade_license_expiry: '20/04/2027',
      shareholder_status: 'Single registered shareholder (100%)',
      vat_start_date: 'Registration in progress; first period Jun 2026',
      incorporation_date: '21/04/2026',
      shareholder_structure: 'Manal Hussein Saleh Alameri 100% (100 shares @ AED 1,000; capital AED 100,000). Note: Mohammed Liyakath co-founded and operates but is not a registered shareholder.',
    },
    reg_facts: {
      incorporationDate: '2026-04-21',
      tradeLicenceExpiry: '2027-04-20',
      vatFirstFiling: '2026-09-28',
      ctFirstFiling: '2027-09-30',
    },
  },
  {
    id: '78173411-67a6-4ad5-bc2c-2888809dffd6',
    name: 'BSK IT Consulting FZE',
    direct: {
      primary_contact_name: 'Abdelkader Khouider Adda Bousekrane (Owner)',
      revenue_bracket: '100% international clients (EUR); under AED 3M — SBR applies 2026',
    },
    facts: {
      launch_date: '12/09/2025',
      founder_location: 'UAE (French national; investor designation)',
      trade_license_start_date: '12/09/2025',
      financial_year_end: '31 December (CT period Sep 2025–Dec 2026)',
      trade_license_number: '4424114.01 (Formation No. 4424114)',
      license_expiry: '11/09/2026 — RENEWAL TO TRACK',
      number_of_branches: '1 — single',
      free_zone_authority: 'Sharjah Publishing City Free Zone (SPCFZ)',
      company_start_date: '12/09/2025',
      vat_filing_deadline: 'None (VAT exemption in progress — all sales outside UAE)',
      budget: 'Not set',
      sole_shareholder: 'Yes — Abdelkader Khouider Adda Bousekrane (100%)',
      trade_license_expiry: '11/09/2026 — RENEWAL TO TRACK',
      shareholder_status: 'Single shareholder (100%)',
      vat_start_date: 'Registration in progress; VAT exemption certificate application in progress',
      incorporation_date: '12/09/2025',
      shareholder_structure: 'Abdelkader Khouider Adda Bousekrane 100% (50 shares @ AED 1,000; capital AED 50,000)',
    },
    reg_facts: {
      incorporationDate: '2025-09-12',
      tradeLicenceExpiry: '2026-09-11',
      ctFirstFiling: '2027-07-31',
    },
  },
  // PANDE AUCTIONS
  {
    id: 'a3a14bbb-9ee8-467f-9338-e5ee7dece0ee',
    name: 'PANDE Auctions LLC',
    direct: {
      primary_contact_name: 'Mohamed Shazin Akhthar (Senior Accountant — primary daily contact)',
      revenue_bracket: 'Active — commissions + listing fees (heavy equipment auctions)',
    },
    facts: {
      launch_date: '22/06/2021 (as Luktah Trading LLC); renamed PANDE Auctions 08/03/2023',
      founder_location: 'Dubai, UAE',
      trade_license_start_date: '29/06/2021',
      financial_year_end: '31 December',
      trade_license_number: '959985',
      license_expiry: '28/06/2027',
      number_of_branches: '1 — Unit 1101, Ibn Battuta Gate, Jebel Ali First, Dubai',
      free_zone_authority: 'N/A — Mainland (Dubai DET)',
      company_start_date: '22/06/2021',
      vat_filing_deadline: 'Quarterly (confirm TRN — group VAT runs through GET/MESA)',
      budget: 'Not set',
      sole_shareholder: 'No — single corporate shareholder (PLANT & EQUIPMENT HOLDING LTD)',
      trade_license_expiry: '28/06/2027',
      shareholder_status: 'Single corporate shareholder (100%)',
      vat_start_date: 'Confirm — group VAT registration via GET/MESA',
      incorporation_date: '22/06/2021',
      shareholder_structure: 'PLANT & EQUIPMENT HOLDING LTD 100% (300 shares; AED 300,000 capital). MD: Saleh Hayder Kuba (USA). Originally Luktah Trading LLC — renamed 08/03/2023.',
    },
    reg_facts: {
      incorporationDate: '2021-06-22',
      tradeLicenceExpiry: '2027-06-28',
    },
  },
  // GET
  {
    id: '83122a25-5707-42e0-9c3f-94a5c78e6bfe',
    name: 'Global Equipment Trading FZE',
    direct: {
      vat_trn: '100397095900003',
      primary_contact_name: 'Mohamed Shazin Akhthar (Senior Accountant — primary daily contact)',
      revenue_bracket: 'Active trading — heavy equipment sales (machine sale price)',
    },
    facts: {
      launch_date: '03/07/2004',
      founder_location: 'Dubai, UAE',
      trade_license_start_date: '03/07/2004',
      financial_year_end: '31 December',
      trade_license_number: '4887',
      license_expiry: '20/12/2026 — nearest renewal in group (URGENT)',
      number_of_branches: '1 — Plot S10516, P.O. Box 261129, Jebel Ali, Dubai (JAFZA yard)',
      free_zone_authority: 'Jebel Ali Free Zone (JAFZA)',
      company_start_date: '03/07/2004',
      vat_filing_deadline: 'Quarterly — Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar (TRN 100397095900003)',
      budget: 'Not set — equipment purchases funded via Zbooni convertible note AED 2.5M',
      sole_shareholder: 'No — single corporate shareholder (PLANT & EQUIPMENT HOLDING LTD)',
      trade_license_expiry: '20/12/2026 — URGENT RENEWAL',
      shareholder_status: 'Single corporate shareholder (100%)',
      vat_start_date: '01/01/2018',
      incorporation_date: '03/07/2004',
      shareholder_structure: 'PLANT & EQUIPMENT HOLDING LTD 100% (Share Certificate No. 174362 — 5 shares; AED 500,000 capital). MD: Saleh Hayder Kuba (USA).',
    },
    reg_facts: {
      incorporationDate: '2004-07-03',
      tradeLicenceExpiry: '2026-12-20',
      vatFirstFiling: '2018-01-01',
    },
  },
  // MESA
  {
    id: 'd61a7daa-eabb-4f4d-8499-de95e745d0b1',
    name: 'Middle East Strategic Advertising LLC',
    direct: {
      vat_trn: '100256069400003',
      primary_contact_name: 'Mohamed Shazin Akhthar (Senior Accountant — primary daily contact)',
      revenue_bracket: 'Active — magazine, listings, EDM, banners (mostly zero-rated exports)',
    },
    facts: {
      launch_date: '12/02/2000',
      founder_location: 'Dubai, UAE',
      trade_license_start_date: '12/02/2000',
      financial_year_end: '31 December',
      trade_license_number: '516627',
      license_expiry: '11/02/2027',
      number_of_branches: '1 — Unit 1105, Ibn Battuta Gate (VAT cert: The Exchange Tower, Business Bay)',
      free_zone_authority: 'N/A — Mainland (Dubai DET)',
      company_start_date: '12/02/2000',
      vat_filing_deadline: 'Quarterly (TRN 100256069400003; mostly zero-rated exports)',
      budget: 'Not set',
      sole_shareholder: 'No — single corporate shareholder (PLANT & EQUIPMENT HOLDING LTD)',
      trade_license_expiry: '11/02/2027',
      shareholder_status: 'Single corporate shareholder (100%)',
      vat_start_date: '01/01/2018',
      incorporation_date: '12/02/2000',
      shareholder_structure: 'PLANT & EQUIPMENT HOLDING LTD 100% (100 shares; AED 100,000 capital). MD: Saleh Hayder Kuba (USA).',
    },
    reg_facts: {
      incorporationDate: '2000-02-12',
      tradeLicenceExpiry: '2027-02-11',
      vatFirstFiling: '2018-01-01',
    },
  },
];

async function main() {
  for (const c of DIRECT) {
    console.log(`\n▶ ${c.name} (${c.id.slice(0, 8)}...)`);

    // Fetch current facts + reg_facts so we don't overwrite existing data
    const { data: cur, error: fetchErr } = await s
      .from('clients')
      .select('facts, reg_facts')
      .eq('id', c.id)
      .single();

    if (fetchErr) { console.error('  ✗ fetch:', fetchErr.message); continue; }

    const mergedFacts = { ...(cur?.facts ?? {}), ...c.facts };
    const mergedReg   = { ...(cur?.reg_facts ?? {}), ...(c.reg_facts ?? {}) };

    const patch = {
      ...c.direct,
      facts: mergedFacts,
      reg_facts: mergedReg,
    };

    const { error } = await s.from('clients').update(patch).eq('id', c.id);
    if (error) console.error('  ✗ update:', error.message);
    else {
      const factCount = Object.keys(c.facts).length;
      const directCount = Object.keys(c.direct).length;
      console.log(`  ✓ ${factCount} facts fields + ${directCount} direct columns updated`);
    }
  }

  console.log('\n✅ All facts patched.');
}

main().catch(console.error);
