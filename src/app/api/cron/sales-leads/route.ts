import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLeadSync } from "@/lib/lead-sync";

// Polls each org's configured Gmail label for new onboarding emails and converts them into
// leads. All rules (which label, optional sender/subject, service list, mailbox) live in
// lead_sync_config and are editable from Settings. Logic is shared with the manual "Sync now"
// button via runLeadSync(). Scheduled in vercel.json; deduped via sales_email_leads.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Every org that has at least one connected Google mailbox is a candidate.
  const { data: conns } = await admin
    .from("member_connections").select("org_id").eq("provider", "google").eq("connected", true);
  const orgIds = [...new Set((conns ?? []).map((c) => c.org_id).filter(Boolean) as string[])];

  const results: Record<string, unknown> = {};
  let created = 0;
  for (const orgId of orgIds) {
    const r = await runLeadSync(orgId);
    results[orgId] = r;
    created += r.created;
  }
  return NextResponse.json({ ok: true, orgs: orgIds.length, created, results });
}
