import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: clients } = await supabase.from("clients").select("id,name,status").in("status", ["onboarding","active","signed"]).order("name");
for (const c of clients ?? []) {
  const { data: rows } = await supabase.from("intake_forms").select("status,submitted,prefilled").eq("client_id", c.id);
  const docCount = (await supabase.from("documents").select("id").eq("client_id", c.id).eq("status","uploaded")).data?.length ?? 0;
  const meetCount = (await supabase.from("client_meetings").select("id").eq("client_id", c.id)).data?.length ?? 0;
  console.log(`\n${c.name}`);
  console.log(`  intake_forms rows: ${rows?.length ?? 0}`);
  for (const r of rows ?? []) {
    const subKeys = r.submitted ? Object.keys(r.submitted) : [];
    const preKeys = r.prefilled ? Object.keys(r.prefilled) : [];
    console.log(`    status=${r.status}, submitted keys=${subKeys.length}: [${subKeys.slice(0,10).join(", ")}]`);
    console.log(`    prefilled keys=${preKeys.length}: [${preKeys.slice(0,10).join(", ")}]`);
  }
  console.log(`  documents uploaded: ${docCount}, meetings: ${meetCount}`);
}
