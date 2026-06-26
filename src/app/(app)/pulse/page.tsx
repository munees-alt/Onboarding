import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { PulseView } from "./pulse-view";
import type { PulseEntry } from "./actions";

export default async function PulsePage() {
  const s = await requireSession();
  const role = s.teamMember?.role ?? s.profile?.role ?? "";
  if (!isMasterAdmin(role)) notFound();
  const orgId = s.profile?.org_id;
  if (!orgId) notFound();

  const supabase = await createClient();
  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: rows }, { data: runs }, { data: meetings }] = await Promise.all([
    supabase.from("pulse_entries").select("*").eq("org_id", orgId).order("entry_date", { ascending: false }),
    supabase.from("onboarding_runs")
      .select("status,progress,current_stage,created_at,clients(name)")
      .eq("org_id", orgId).gte("created_at", since14).order("created_at", { ascending: false }),
    supabase.from("client_meetings")
      .select("title,meeting_date,summary,created_at,clients(name)")
      .eq("org_id", orgId).gte("created_at", since14).order("created_at", { ascending: false }),
  ]);

  const cname = (c: unknown) => { const x = Array.isArray(c) ? c[0] : c; return (x as { name?: string } | null)?.name ?? "Client"; };
  const onboardings = (runs ?? []).map((r) => ({ client: cname((r as { clients?: unknown }).clients), status: r.status, progress: r.progress, stage: r.current_stage, created: r.created_at as string }));
  const mtgs = (meetings ?? []).map((m) => ({ client: cname((m as { clients?: unknown }).clients), title: m.title as string, date: (m.meeting_date ?? m.created_at) as string, summary: (m.summary as string | null) ?? null }));

  return <PulseView entries={(rows ?? []) as PulseEntry[]} onboardings={onboardings} meetings={mtgs} />;
}
