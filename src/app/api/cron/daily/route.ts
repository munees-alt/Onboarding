import { NextResponse, type NextRequest } from "next/server";

// Master daily cron — fans out to the individual job routes so Vercel Hobby's
// single-cron quota covers all scheduled work. Each fan-out call is best-effort
// (errors logged but don't block the next job). The client-digests sub-job
// short-circuits on non-Monday days.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get("host")}`;
  const headers: HeadersInit = secret ? { authorization: `Bearer ${secret}` } : {};
  const jobs = ["task-sla", "sales-leads", "admin-tasks"];
  if (new Date().getUTCDay() === 1) jobs.push("client-digests");  // Monday only

  const results: Record<string, unknown> = {};
  for (const job of jobs) {
    try {
      const r = await fetch(`${base}/api/cron/${job}`, { headers, cache: "no-store" });
      results[job] = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
    } catch (e) {
      results[job] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
