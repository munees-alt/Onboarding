/**
 * Normalise department names in team_members so access overrides work.
 * Canonical names (em-dash, proper casing):
 *   FinOps – Medium | FinOps – Micro A | FinOps – Micro B | FinOps – Annual
 *   Tax | Onboarding | AML & Compliance
 *
 * Run: node --env-file=.env.local scripts/normalize-depts.mjs
 */
import { createClient } from '@supabase/supabase-js';

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAP = {
  // FinOps - Medium variants
  'finops - medium': 'FinOps – Medium',
  'finops medium':   'FinOps – Medium',
  'finops-medium':   'FinOps – Medium',
  // FinOps - Micro A variants
  'finops - micro a': 'FinOps – Micro A',
  'finops micro a':   'FinOps – Micro A',
  'finops-micro a':   'FinOps – Micro A',
  // FinOps - Micro B variants
  'finops - micro b': 'FinOps – Micro B',
  'finops micro b':   'FinOps – Micro B',
  'finops-micro b':   'FinOps – Micro B',
  // FinOps - Annual variants
  'finops - annual':  'FinOps – Annual',
  'finops annual':    'FinOps – Annual',
  'finops-annual':    'FinOps – Annual',
  // AML
  'aml team':          'AML & Compliance',
  'aml':               'AML & Compliance',
  'aml compliance':    'AML & Compliance',
  'aml & compliance':  'AML & Compliance',
  // Tax
  'tax team': 'Tax',
  // Onboarding
  'onboarding team': 'Onboarding',
};

async function main() {
  const { data: members, error } = await s
    .from('team_members')
    .select('id, dept')
    .not('dept', 'is', null);

  if (error) { console.error(error.message); process.exit(1); }

  let updated = 0;
  for (const m of members) {
    const canonical = MAP[m.dept.toLowerCase().trim()];
    if (!canonical || canonical === m.dept) continue;

    const { error: e } = await s
      .from('team_members')
      .update({ dept: canonical })
      .eq('id', m.id);

    if (e) console.error(`  ✗ ${m.id}: ${e.message}`);
    else { console.log(`  ✓ "${m.dept}" → "${canonical}"`); updated++; }
  }

  console.log(`\nDone — ${updated} rows updated.`);
}

main().catch(console.error);
