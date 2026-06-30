// One-time migration: add task_pending_sla_days to followup_config
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Add column via RPC (raw SQL through Supabase)
const { error } = await admin.rpc("exec_sql", {
  sql: "ALTER TABLE followup_config ADD COLUMN IF NOT EXISTS task_pending_sla_days integer DEFAULT 3;",
});

if (error) {
  // Might not have exec_sql — try a direct upsert approach instead
  console.log("exec_sql not available, trying upsert with column...", error.message);
} else {
  console.log("Column added successfully");
}

// Verify by reading
const { data, error: e2 } = await admin.from("followup_config").select("*").limit(1);
console.log("Current rows:", data, e2);
