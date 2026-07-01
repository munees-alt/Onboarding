import { NextResponse, type NextRequest } from "next/server";

// Archived (platform cleanup, 2026-07) — Weekly Client Updates is no longer part
// of the product. This cron is now a no-op so it stops creating drafts / Action
// Items that point at an unreachable page. Historical weekly_client_updates rows
// are left in the database untouched. Restore from git history if this ever
// needs to come back.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, archived: true, created: 0 });
}
