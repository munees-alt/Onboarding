import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSendingEnabled, sendQueuedEmail } from "@/lib/email";

// SendGrid batch sender (platform cleanup, 2026-07). Rows land in email_batch
// via queueEmail() from follow-up / data-request / team-update flows. This
// cron is the only thing that actually sends — and it does nothing until
// emailSendingEnabled() is true, so shipping the queue today is risk-free.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!emailSendingEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, sent: 0, note: "Email sending is disabled — queued rows are left as-is." });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("email_batch")
    .select("id,to_email,to_name,subject,body_html,body_text")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(50);

  let sent = 0;
  const failures: string[] = [];
  for (const row of rows ?? []) {
    const res = await sendQueuedEmail(row);
    if ("error" in res) {
      failures.push(`${row.id}: ${res.error}`);
      await admin.from("email_batch").update({ status: "failed", error: res.error }).eq("id", row.id);
      continue;
    }
    sent++;
    await admin.from("email_batch").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
  }

  return NextResponse.json({ ok: true, enabled: true, sent, failed: failures.length, failures });
}
