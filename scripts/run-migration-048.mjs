/**
 * Creates dept_overrides and user_nav_overrides tables for department and
 * user-specific access control.
 * Run: node --env-file=.env.local scripts/run-migration-048.mjs
 */
import { createClient } from "@supabase/supabase-js";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Test that the tables exist by trying a select. If they don't, we'll get an error.
const checks = await Promise.all([
  s.from("dept_overrides").select("org_id").limit(0),
  s.from("user_nav_overrides").select("org_id").limit(0),
]);

for (const [i, { error }] of checks.entries()) {
  const name = i === 0 ? "dept_overrides" : "user_nav_overrides";
  if (error) {
    console.error(`✗ ${name} does not exist: ${error.message}`);
    console.error("  → Apply supabase/migrations/0048_dept_user_access_overrides.sql in the Supabase dashboard SQL editor.");
  } else {
    console.log(`✓ ${name} exists`);
  }
}
