import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: rows, error } = await s
  .from("team_members")
  .select("*")
  .limit(2000);

if (error) { console.error("Error:", error); process.exit(1); }
console.log(`Total: ${rows.length}`);
console.log("Columns on first row:", Object.keys(rows[0] ?? {}).join(", "));

console.log("\nName containing gauth/gowth/naf or title with tax:");
for (const r of rows) {
  const n = (r.full_name ?? "").toLowerCase();
  const t = (r.title ?? "").toLowerCase();
  if (n.includes("gauth") || n.includes("gowth") || n.includes("naf") || t.includes("tax")) {
    console.log(`  ${(r.full_name ?? "").padEnd(40)} · role=${(r.role ?? "").padEnd(14)} · title=${r.title ?? "—"} · id=${r.id}`);
  }
}

console.log("\nDistinct roles:");
const roles = new Set();
for (const r of rows) if (r.role) roles.add(r.role);
console.log([...roles].sort().join(" · "));
