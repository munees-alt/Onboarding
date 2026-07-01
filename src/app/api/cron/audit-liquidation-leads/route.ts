import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAlSync } from "@/lib/audit-liquidation-sync";

// Polls each org's "Cadence Audit and Liquidation" Gmail label and converts new
// emails into audit/liquidation cases (a client + a run on the matching
// template). Rules live in al_sync_config, editable from Settings. Shares logic
// with the manual "Sync now" button via runAlSync(). Deduped via al_email_cases.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: conns } = await admin
    .from("member_connections").select("org_id").eq("provider", "google").eq("connected", true);
  const orgIds = [...new Set((conns ?? []).map((c) => c.org_id).filter(Boolean) as string[])];

  const results: Record<string, unknown> = {};
  let created = 0;
  for (const orgId of orgIds) {
    const r = await runAlSync(orgId);
    results[orgId] = r;
    created += r.created;
  }
  return NextResponse.json({ ok: true, orgs: orgIds.length, created, results });
}
