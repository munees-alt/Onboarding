
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const data = [
  {clientId:"78173411-67a6-4ad5-bc2c-2888809dffd6",clientName:"BSK IT Consulting FZE",ownerName:"Abdelkader Khouider Adda Bousekrane",email:"aababdelkader@gmail.com",phone:"+971503430729",licenseNumber:"4424114.01",licenseExpiry:"2026-09-11",licenseAuthority:"Sharjah Publishing City Free Zone (SPCFZ)",industry:"Information Technology Consulting, IT Services, Project Management and Information Technology Consultancy, Innovation and Artificial Intelligence Research and Consultancies",entityType:"FZE (Free Zone Establishment)",vatRegistered:"No"},
  {clientId:"7a44cd33-578e-4ee5-bf1c-b553ca3219a4",clientName:"Alhussein Group FZE",ownerName:"Aden Abdulgadir Hussein",licenseNumber:"4430120.01",licenseExpiry:"2027-06-07",licenseAuthority:"Sharjah Publishing City Free Zone (SPCFZ)",industry:"General Trading; Cyber Security Architecture; IT Consultancy and Marketing Consultancy; Project Management Services; Music Consultancy",entityType:"FZE (Free Zone Establishment)"},
  {clientId:"4087c8cd-775d-4e6c-bbc5-c1e00b02c8c0",clientName:"ALTARYON GLOBAL ENERGY COMMODITY TRADING FZCO",ownerName:"Zeynep Gurkas (Company Manager)",phone:"+971567266766",licenseNumber:"DMCC-1021258",licenseExpiry:"2027-04-20",licenseAuthority:"DMCC (Dubai Multi Commodities Centre)",industry:"Energy & Commodity Trading — Grains, Cereals & Legumes Trading; Crude Oil Trading Abroad; Trading Refined Oil Products Abroad; Petrochemicals Trading",entityType:"FZCO (Free Zone Company)",vatRegistered:"No — not registered for VAT or Corporate Tax (as declared in proposal scope declaration)"},
  {clientId:"19b01223-8c0c-432f-a64e-0b3cbc3772f6",clientName:"BluTalent Human Resources Consultancies Co LLC",ownerName:"Syed Abid Ali Sabzwari Syed Aijaz Ali Sabzwari (50%) | Shashi Parkash Tarsem Kumar (50%)",email:"sabzwari68@gmail.com",phone:"+971-55-4227131 / +971-58-8212308",licenseNumber:"1292869",licenseExpiry:"2027-01-14",licenseAuthority:"Dubai Department of Economy and Tourism (DET)",licenseName:"BLUTALENT HUMAN RESOURCES CONSULTANCIES L.L.C",industry:"Human Resources Consultancies, Management Consultancies, Marketing Research and Consultancies",entityType:"LLC (Limited Liability Company)"},
  {clientId:"e59c8872-5d54-4bbf-a5a2-20a7c781ccc2",clientName:"Cross Border Consultancy FZCO",ownerName:"Saurabh Saxena",licenseNumber:"S3017",licenseExpiry:"2026-11-04",licenseAuthority:"Dubai Integrated Economic Zones Authority (IFZA)",licenseName:"CROSS BORDER CONSULTANCY - FZCO",industry:"Management Consultancies; Immigration Services; Investment in Technological Enterprises & Management",entityType:"FZCO (Freezone Company)"},
  {clientId:"98bb3809-b820-422f-9ec1-30308c0956a0",clientName:"EMARGROW FZE LLC",ownerName:"Manal Hussein Saleh Alameri",email:"emargrow7@gmail.com",phone:"+971554223077",licenseAuthority:"Ajman Free Zone Authority (AFZA) — inferred from entity type FZE LLC and registered address in Ajman (Amber Gem Tower, Sheikh Khalifa Street)",licenseName:"EMARGROW FZE LLC",industry:"Retail — Trading in fresh produce and food commodities (E-Commerce and Offline); active invoicing to fruit and vegetable wholesale buyers",entityType:"FZE LLC (Free Zone Establishment Limited Liability Company)",vatRegistered:"Yes — TRN: 104272851700003 (registered 2024-05-01); secondary TRN on newer Zoho org: 105454267300003"},
  {clientId:"0b50b66c-5b7b-4375-99c2-8b406e11d814",clientName:"FRESH DAILY BAKERY PRODUCTS MANUFACTURING L.L.C",ownerName:"Gerard El Tawil; Majdi Walid Atallah; Fresh Daily Foodstuff Trading LLC",email:"FAHED@RGA-GROUP.COM",phone:"+971-50-6455680",licenseNumber:"1063565",licenseExpiry:"2024-06-16",licenseAuthority:"Dubai Department of Economy and Tourism (DET) — Industrial License",licenseName:"FRESH DAILY BAKERY PRODUCTS MANUFACTURING L.L.C",industry:"Bakery Products Manufacturing",entityType:"LLC-SO (Limited Liability Company - Single Owner)",vatRegistered:"Yes — TRN: 104152341400003; Effective Registration Date: 01/12/2023; First VAT Return Period: 01/12/2023 – 29/02/2024"},
  {clientId:"564f250b-896d-41fc-939c-22830131663b",clientName:"NOVAMED RESCUE Medical Treatment Facilitation Services CO. L.L.C S.O.C",ownerName:"Moataz Alhadi Miloud Igressa",email:"Igressa@myyahoo.com",phone:"+971-54-4624684",licenseNumber:"1515340",licenseExpiry:"2027-06-07",licenseAuthority:"Dubai Department of Economic Development (Dubai DED)",licenseName:"NOVAMED RESCUE Medical Treatment Facilitation Services CO. L.L.C S.O.C",activityDescription:"Medical Treatment Facilitation Services (Healthcare and Wellness) — facilitating medical treatment services; active license activity as per Dubai DED.",entityType:"Limited Liability Company - Single Owner (LLC-SO)",vatRegistered:"No — Corporate Tax registered only; not VAT registered",industry:"Healthcare and Wellness — Medical Treatment Facilitation Services"},
  {clientId:"9463b1ec-6fbc-414b-8f67-606c673454ae",clientName:"Stream Freight LLC FZ",ownerName:"Ivalena Dragostinova Mihaylova Djahova",licenseNumber:"2542907.01",licenseExpiry:"2026-12-25",licenseAuthority:"Meydan Free Zone (Meydan FZ)",industry:"Freight Forwarding and Logistics — Operation of storage and warehouse facilities for all kinds of goods; forwarding of freight; arranging or organizing transport operations by rail, road, sea or air",entityType:"LLC-FZ (Limited Liability Company — Free Zone)",vatRegistered:"no — Corporate Tax registered only; not VAT registered"},
  {clientId:"430e751b-1c9a-4ec6-9fd1-7e7837852ae2",clientName:"TRINOVATE TECHNOLOGIES - FZCO",ownerName:"MARC CHAMLY",licenseNumber:"87882",licenseExpiry:"2027-05-03",licenseAuthority:"IFZA (Dubai Integrated Economic Zones Authority / DIEZA)",licenseName:"TRINOVATE TECHNOLOGIES - FZCO",industry:"Computer Systems & Communication Equipment Software Design; Computer Systems & Communication Equipment Software Trading; General Trading",entityType:"FZCO"}
];

for (const r of data) {
  const patch = {};
  if (r.ownerName) patch.owner_name = r.ownerName;
  if (r.email) patch.primary_contact_email = r.email;
  if (r.phone) patch.primary_contact_phone = r.phone;
  if (r.licenseNumber) patch.trade_license_number = r.licenseNumber;
  if (r.licenseExpiry) patch.trade_license_expiry = r.licenseExpiry;
  if (r.licenseAuthority) patch.license_authority = r.licenseAuthority;
  if (r.industry) patch.industry = r.industry;
  if (r.activityDescription) patch.business_description = r.activityDescription;
  if (r.vatRegistered) patch.vat_registered = r.vatRegistered;
  if (r.entityType) patch.entity_type = r.entityType;
  if (r.licenseName) patch.name = r.licenseName;
  if (Object.keys(patch).length) {
    const {error} = await s.from('clients').update(patch).eq('id', r.clientId);
    if (error) console.error('Error updating', r.clientName, '|', error.message);
    else console.log('Updated:', r.clientName, '|', Object.keys(patch).join(', '));
  }
}
console.log('All done');
