import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendClientWeeklyDigestForOrg } from "@/lib/client-digest";

// Weekly client digest cron — runs every Monday at 8 AM UTC (configured in
// vercel.json). For every active client (status onboarding / live) with a
// primary contact email, builds the Monday status digest and sends it via
// the AM's connected Gmail.
//
// Deduped: skips a client if a weekly_digest_sent audit_event landed in the
// last 6 days. Prevents double-send if the cron fires twice or the user hits
// the manual button the same day.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: clients } = await admin
    .from("clients")
    .select("id,org_id,name,primary_contact_email,status")
    .in("status", ["onboarding", "live"])
    .not("primary_contact_email", "is", null);

  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<{ id: string; result: string }> = [];

  for (const c of clients ?? []) {
    const { data: recent } = await admin
      .from("audit_events")
      .select("id")
      .eq("resource_id", c.id)
      .eq("action", "weekly_digest_sent")
      .gte("created_at", sixDaysAgo)
      .limit(1)
      .maybeSingle();
    if (recent) { skipped++; details.push({ id: c.id, result: "skip:recent" }); continue; }

    const res = await sendClientWeeklyDigestForOrg(c.org_id as string, c.id as string);
    if (res.ok) { sent++; details.push({ id: c.id, result: "sent" }); }
    else { failed++; details.push({ id: c.id, result: `fail:${res.error}` }); }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed, scanned: clients?.length ?? 0, details });
}
