import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: clients } = await supabase.from("clients").select("id,name,bank_names,payment_gateways,revenue_channels,accounting_software,vat_registered,ct_registered").in("status", ["onboarding","active","signed"]).order("name").limit(3);
for (const c of clients ?? []) {
  const { data: rows } = await supabase.from("intake_forms").select("submitted,prefilled").eq("client_id", c.id);
  console.log(`\n${c.name}`);
  console.log(`  Client banks=${JSON.stringify(c.bank_names)}, gateways=${JSON.stringify(c.payment_gateways)}, sw=${c.accounting_software}, vat=${c.vat_registered}, ct=${c.ct_registered}`);
  for (const r of rows ?? []) {
    console.log(`  submitted=${JSON.stringify(r.submitted).slice(0,200)}`);
    console.log(`  prefilled=${JSON.stringify(r.prefilled).slice(0,400)}`);
  }
}
