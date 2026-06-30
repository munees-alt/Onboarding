import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const targets = [
  {
    clientId: "7a44cd33-578e-4ee5-bf1c-b553ca3219a4",
    name: "Alhussein Group FZE",
    signingLink: "http://amltool.finanshels.com/kyc-sign/7235c29f-70b4-443a-824f-55935b41ca64",
  },
  {
    clientId: "564f250b-896d-41fc-939c-22830131663b",
    name: "NOVAMED RESCUE Medical Treatment Facilitation Services CO. L.L.C S.O.C",
    signingLink: "https://amltool.finanshels.com/kyc-sign/3e80650e-6431-4e46-a35a-a2be8bfed3b1",
  },
];

const { data: anyClient } = await supabase.from("clients").select("org_id").limit(1).single();
if (!anyClient?.org_id) {
  console.error("Could not resolve org_id");
  process.exit(1);
}
const orgId = anyClient.org_id;

for (const t of targets) {
  const { error } = await supabase.from("aml_records").upsert(
    {
      org_id: orgId,
      client_id: t.clientId,
      status: "document_created",
      signing_link: t.signingLink,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) {
    console.error(`✗ ${t.name}:`, error.message);
  } else {
    console.log(`✓ ${t.name} → document_created · ${t.signingLink}`);
  }
}

console.log("Done.");
