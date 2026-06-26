// Simulates what saveContractAnalysis now does for a group: write a contract
// run_item on one sibling, then mirror to all other siblings in the same group.
// Verifies before/after that every sibling gets the contract row.
// Run: node --env-file=.env.local scripts/test-group-mirror.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: group } = await db.from("client_groups").select("id,name").eq("name", "Plant & Equipment").single();
console.log(`Group: ${group.name} (${group.id})`);

const { data: runs } = await db.from("onboarding_runs").select("id,client_id,clients(name)").eq("group_id", group.id);
console.log(`Runs in group: ${runs.length}`);
for (const r of runs) console.log(`  • ${r.clients.name} run=${r.id.slice(0,8)}`);

// BEFORE
console.log("\nBEFORE — contract run_items per sibling:");
for (const r of runs) {
  const { data: ri } = await db.from("run_items").select("id,data").eq("run_id", r.id).eq("kind", "contract");
  console.log(`  ${r.clients.name}: ${ri?.length ?? 0} rows`);
}

// Pick the source run (Middle East Strategic Advertising)
const source = runs.find((r) => r.clients.name.includes("MIDDLE EAST"));
const siblings = runs.filter((r) => r.id !== source.id);
const contractData = {
  scope: "Bookkeeping + VAT + Corporate Tax",
  monthlyFee: 1500,
  currency: "AED",
  startDate: "2026-07-01",
  __testMarker: "group-mirror-smoke-test",
  __testRunAt: new Date().toISOString(),
};

// 1) Write on source (what saveContractAnalysis does without mirror)
console.log(`\nWriting contract on source run (${source.clients.name})…`);
await db.from("run_items").delete().eq("run_id", source.id).eq("kind", "contract");
await db.from("run_items").insert({
  run_id: source.id, client_id: source.client_id, kind: "contract", data: contractData,
});

// 2) Simulate mirror (this is what mirrorToGroupSiblings will do via the action)
console.log(`Mirroring to ${siblings.length} siblings…`);
for (const sib of siblings) {
  await db.from("run_items").delete().eq("run_id", sib.id).eq("kind", "contract");
  await db.from("run_items").insert({
    run_id: sib.id, client_id: sib.client_id, kind: "contract", data: contractData,
  });
}

// AFTER
console.log("\nAFTER — contract run_items per sibling:");
let okAll = true;
for (const r of runs) {
  const { data: ri } = await db.from("run_items").select("id,data").eq("run_id", r.id).eq("kind", "contract");
  const hasMarker = ri?.[0]?.data?.__testMarker === "group-mirror-smoke-test";
  console.log(`  ${r.clients.name}: ${ri?.length ?? 0} rows | marker=${hasMarker ? "Y" : "N"}`);
  if (!hasMarker) okAll = false;
}

// CLEANUP — leave the system clean (these were test rows)
console.log("\nCleaning up test rows…");
for (const r of runs) {
  await db.from("run_items").delete().eq("run_id", r.id).eq("kind", "contract").eq("data->>__testMarker", "group-mirror-smoke-test");
}
console.log(okAll ? "\nPASS — all 3 sibling runs received the mirrored contract row." : "\nFAIL — at least one sibling missed the mirror.");
