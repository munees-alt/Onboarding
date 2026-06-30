"use server";
import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function masterGuard(role: string) {
  if (role !== "admin") throw new Error("Master admin only");
}

function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function runAutoPoints() {
  const s = await requireSession();
  masterGuard(s.profile.role);

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/cron/auto-points`,
    {
      method: "POST",
      headers: {
        "x-cron-secret": process.env.CRON_SECRET ?? "",
        "Content-Type": "application/json",
      },
    }
  );
  const body = await res.json();
  return body as { ok: boolean; week: string; awarded: number };
}

export async function awardManualPoints(memberId: string, points: number, reason: string) {
  const s = await requireSession();
  masterGuard(s.profile.role);

  const admin = createAdminClient();
  const wk = weekKey();
  const { error } = await admin.from("user_points").insert({
    org_id: s.profile.org_id,
    member_id: memberId,
    points,
    reason,
    awarded_by: s.profile.id,
    source: "manual",
    week_key: wk,
  });
  if (error) throw new Error(error.message);
}
