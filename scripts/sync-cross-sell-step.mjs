// Inject the cross-sell checklist step (t4.1b / m4.1b / e5.2b) into existing
// DB-stored templates so new runs created from them pick it up. Idempotent —
// re-running skips templates that already have the step.

import pg from "pg";

const CROSS_SELL_ITEMS = [
  "Statutory audit (revenue > AED 50M or required by free zone)",
  "Salary benchmarking — owner / executive comp review",
  "VAT registration (estimated taxable revenue > AED 375K)",
  "Corporate Tax registration (every UAE entity)",
  "Prior-period catch-up bookkeeping",
  "AML / UBO compliance (DNFBP — real estate / brokers / dealers)",
];

function crossSellStep(id) {
  return {
    id,
    title: "Cross-sell checklist — what else does this client need?",
    kind: "person",
    who: ["AM"],
    note: "Tick every additional service the client is likely to need. Each ticked item is captured for follow-up — don't sell on the call.",
    act: { type: "checklist", btn: "Cross-sell captured", items: CROSS_SELL_ITEMS },
  };
}

// (templateId, anchorStepId, newStepId) — insert AFTER the anchor step.
const TARGETS = [
  ["medium-team", "t4.1", "t4.1b"],
  ["micro", "m4.1", "m4.1b"],
  ["micro-team", "m4.1", "m4.1b"],
  ["micro-2", "m4.1", "m4.1b"],
  ["medium-enterprise", "e5.2", "e5.2b"],
];

function connStr() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL not set");
  return raw.replace(":6543/", ":5432/");
}

async function main() {
  const client = new pg.Client({ connectionString: connStr(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  let patched = 0;
  for (const [tplId, anchorId, newId] of TARGETS) {
    const { rows } = await client.query("select data from onboarding_templates where id=$1", [tplId]);
    if (!rows.length) { console.log(`  - ${tplId}: not in DB, skip`); continue; }
    const data = rows[0].data;
    let inserted = false;
    for (const stage of data.stages ?? []) {
      const idx = (stage.steps ?? []).findIndex((s) => s.id === anchorId);
      if (idx === -1) continue;
      if (stage.steps.some((s) => s.id === newId)) { console.log(`  - ${tplId}: ${newId} already present, skip`); inserted = true; break; }
      stage.steps.splice(idx + 1, 0, crossSellStep(newId));
      inserted = true;
      break;
    }
    if (inserted && !rows[0].data.stages.some((s) => s.steps.some((st) => st.id === newId))) continue;
    if (!inserted) { console.log(`  - ${tplId}: anchor ${anchorId} not found, skip`); continue; }
    await client.query("update onboarding_templates set data=$1, updated_at=now() where id=$2", [data, tplId]);
    console.log(`  ✓ ${tplId}: ${newId} inserted after ${anchorId}`);
    patched++;
  }
  await client.end();
  console.log(`Done. ${patched} template${patched === 1 ? "" : "s"} patched.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
