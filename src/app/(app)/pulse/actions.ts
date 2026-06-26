"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { runAi } from "@/lib/ai";
import { sendGmailAs, getDriveCapableMemberId } from "@/lib/google";

// NOTE: this is a "use server" module — it may ONLY export async functions. Category
// constants live in the client view (pulse-view.tsx), not here. Types are erased so the
// PulseEntry interface export is fine.
export interface PulseEntry {
  id: string; category: string; title: string; detail: string | null;
  status: string | null; owner: string | null; entry_date: string; source: string; created_by: string | null;
}

async function requireAdmin() {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." as string };
  const role = session.teamMember?.role ?? session.profile.role;
  if (role !== "admin") return { error: "Master Admin only." as string };
  return { session, role, orgId: session.profile.org_id };
}

export async function addPulseEntry(
  category: string, title: string, detail: string, owner?: string,
): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireAdmin();
  if ("error" in g) return { error: g.error };
  if (!title.trim()) return { error: "Add a title." };
  const supabase = await createClient();
  const { error } = await supabase.from("pulse_entries").insert({
    org_id: g.orgId, category, title: title.trim(), detail: detail.trim() || null,
    owner: owner?.trim() || null,
    status: category === "todo" ? "open" : null,
    created_by: g.session.teamMember?.full_name ?? g.session.email,
  });
  if (error) return { error: error.message };
  revalidatePath("/pulse");
  return { ok: true };
}

export async function deletePulseEntry(id: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { error } = await supabase.from("pulse_entries").delete().eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  revalidatePath("/pulse");
  return { ok: true };
}

export async function setPulseTodoStatus(id: string, status: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { error } = await supabase.from("pulse_entries").update({ status }).eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  revalidatePath("/pulse");
  return { ok: true };
}

const DAY = 86_400_000;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

/** Live data for the digest: onboardings + meetings from the last 2 weeks. */
async function gatherActivity(orgId: string) {
  const supabase = await createClient();
  const since = isoDaysAgo(14);
  const [{ data: runs }, { data: meetings }] = await Promise.all([
    supabase.from("onboarding_runs")
      .select("status,progress,current_stage,created_at,go_live_date,clients(name)")
      .eq("org_id", orgId).gte("created_at", since).order("created_at", { ascending: false }),
    supabase.from("client_meetings")
      .select("title,meeting_date,summary,created_at,clients(name)")
      .eq("org_id", orgId).gte("created_at", since).order("created_at", { ascending: false }),
  ]);
  const cname = (c: unknown) => { const x = Array.isArray(c) ? c[0] : c; return (x as { name?: string } | null)?.name ?? "Client"; };
  const onboardings = (runs ?? []).map((r) => ({
    client: cname((r as { clients?: unknown }).clients), status: r.status, progress: r.progress, stage: r.current_stage, created: r.created_at,
  }));
  const mtgs = (meetings ?? []).map((m) => ({
    client: cname((m as { clients?: unknown }).clients), title: m.title, date: m.meeting_date ?? m.created_at, summary: m.summary,
  }));
  return { onboardings, meetings: mtgs };
}

/** Compose the weekly management digest email from the Pulse entries + live activity. */
export async function generateWeeklyDigest(): Promise<{ error?: string; subject?: string; body?: string }> {
  const g = await requireAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const since = isoDaysAgo(7);
  const { data: rows } = await supabase.from("pulse_entries").select("*").eq("org_id", g.orgId).order("entry_date", { ascending: false });
  const entries = (rows ?? []) as PulseEntry[];
  const recent = entries.filter((e) => e.entry_date >= since || e.category === "todo" || e.category === "focus");
  const byCat = (c: string) => recent.filter((e) => e.category === c).map((e) => `- ${e.title}${e.detail ? `: ${e.detail}` : ""}`).join("\n") || "- (none recorded)";
  const todos = entries.filter((e) => e.category === "todo").map((e) => `- [${(e.status ?? "open").toUpperCase()}] ${e.title}${e.owner ? ` (owner: ${e.owner})` : ""}`).join("\n") || "- (none)";

  const { onboardings, meetings } = await gatherActivity(g.orgId);
  const obText = onboardings.length
    ? onboardings.map((o) => `- ${o.client}: ${o.status}, ${o.progress}% (stage ${o.stage})`).join("\n")
    : "- (no new onboardings recorded in the app this period)";
  const mtgText = meetings.length
    ? meetings.map((m) => `- ${m.client} — ${m.title}${m.summary ? `: ${m.summary}` : ""}`).join("\n")
    : "- (no client meetings recorded in the app this period)";

  const prompt =
    `Write a WEEKLY MANAGEMENT DIGEST email for the leadership of Finanshels about the Cadence onboarding app and operations. ` +
    `Audience: management (founders/heads) — keep it professional, clear and SIMPLE, not technical or long. Use short sections with bullet points. ` +
    `Structure the email with these headed sections (omit a section only if it is genuinely empty): ` +
    `1) What we shipped this week (new features), 2) Improvements, 3) Security updates, 4) Feedback received & how we acted on it, 5) Onboardings this period, 6) Meetings, 7) Problems / risks, 8) Focus & to-dos for the coming week. ` +
    `End with a one-line bottom line. Do NOT invent anything — use only the facts below; if a section has no data, write a brief honest note. Return PLAIN TEXT only (no markdown symbols like # or *), suitable to paste into an email.\n\n` +
    `=== NEW FEATURES ===\n${byCat("feature")}\n\n=== IMPROVEMENTS ===\n${byCat("improvement")}\n\n=== SECURITY ===\n${byCat("security")}\n\n` +
    `=== FEEDBACK ===\n${byCat("feedback")}\n\n=== PROBLEMS ===\n${byCat("problem")}\n\n=== RESEARCH ===\n${byCat("research")}\n\n` +
    `=== ONBOARDINGS (live from the app) ===\n${obText}\n\n=== MEETINGS (live from the app) ===\n${mtgText}\n\n` +
    `=== MANAGEMENT TO-DOS / FOCUS ===\n${todos}\n${byCat("focus")}\n`;

  try {
    const out = await runAi(g.orgId, "handover_summary", {
      system: "You are the chief of staff writing a crisp weekly digest for company leadership. Professional, plain-English, concise. No fluff, no invented facts.",
      prompt,
    });
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return { subject: `Cadence — Weekly Management Digest (${today})`, body: out.trim() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't generate the digest." };
  }
}

/** Email the digest to management via a connected Gmail. */
export async function sendDigest(to: string, subject: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireAdmin();
  if ("error" in g) return { error: g.error };
  const recipients = to.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (!recipients.length) return { error: "Enter at least one valid recipient email." };
  const sender = await getDriveCapableMemberId(g.orgId);
  if (!sender) return { error: "Connect a Google account first (My Connections) to send the email." };
  const res = await sendGmailAs(sender, recipients.join(","), subject, body);
  if (!res.ok) return { error: res.error ?? "Couldn't send the email." };
  return { ok: true };
}
