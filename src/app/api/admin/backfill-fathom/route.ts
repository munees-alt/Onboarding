import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listFathomMeetings, fathomMeetingNotes, fathomMeetingEmails } from "@/lib/fathom";
import { _extractInsightsForClient } from "@/app/(app)/clients/actions";
import { getSession } from "@/lib/auth";

// One-shot backfill: pulls every Fathom meeting for the org and, for each
// client, inserts any matching meeting into client_meetings (idempotent) then
// runs the AI extractor on the latest matched call so the playbook
// (business_description, pain_points, VAT/CT registration, revenue/expense
// channels, banks, software, sections) gets populated.
//
// Protected by CRON_SECRET when set, otherwise requires an admin/ops_head
// session. Triggered manually from the "Run Fathom backfill" link in My Work.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const cronOk = secret && auth === `Bearer ${secret}`;
  let orgId: string | null = null;
  if (!cronOk) {
    const session = await getSession();
    if (!session?.profile.org_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (session.profile.role !== "admin" && session.profile.role !== "ops_head") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    orgId = session.profile.org_id;
  }

  const admin = createAdminClient();
  const orgs = orgId ? [{ id: orgId }] : ((await admin.from("orgs").select("id")).data ?? []);
  const report: Array<{
    org_id: string;
    client: string;
    meetings_found: number;
    meetings_added: number;
    meetings_skipped: number;
    insights_run: boolean;
    insights_error?: string;
  }> = [];

  const GENERIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "me.com", "aol.com"]);

  // Strip ONLY legal-form suffixes (FZE / LLC / FZ / FZCO / L.L.C / Ltd / Inc /
  // Co.) and punctuation so the matcher compares the distinctive part of the
  // name. We keep words like "Consulting", "Group", "Holdings", "Trading"
  // because they're often the only distinctive token (e.g. "BSK IT Consulting").
  const cleanName = (raw: string) => raw
    .toLowerCase()
    .replace(/\b(fze|fzco|fz|llc|l\.l\.c|ltd|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  for (const org of orgs) {
    const meetings = await listFathomMeetings(org.id);
    if (!meetings) {
      report.push({ org_id: org.id, client: "—", meetings_found: 0, meetings_added: 0, meetings_skipped: 0, insights_run: false, insights_error: "Fathom not connected" });
      continue;
    }

    const { data: clients } = await admin
      .from("clients")
      .select("id,name,primary_contact_email,call_link")
      .eq("org_id", org.id);

    for (const c of clients ?? []) {
      const cleaned = cleanName(c.name ?? "");
      // 3+ chars so "BSK", "JP" still register as distinctive; legal-form
      // suffixes (FZE/LLC etc) were already stripped above.
      const tokens = cleaned.split(/\s+/).filter((w) => w.length >= 3);
      const email = (c.primary_contact_email ?? "").trim().toLowerCase();
      const domain = email.split("@")[1] ?? "";
      const domainUsable = !!domain && !GENERIC_DOMAINS.has(domain);
      const callLink = (c.call_link ?? "").trim();
      const callLinkToken = callLink ? callLink.split("/").pop() ?? "" : "";

      const matches = meetings.filter((m) => {
        // Direct match: client.call_link points at this Fathom share URL. Wins
        // even when the meeting title says nothing about the client (e.g.
        // "Emi and saurabh" for Cross Border).
        if (callLink && (m.share_url === callLink || m.url === callLink || (callLinkToken && (m.share_url?.includes(callLinkToken) || m.url?.includes(callLinkToken))))) return true;
        const tRaw = (m.title ?? m.meeting_title ?? "").toLowerCase();
        const tClean = cleanName(tRaw);
        if (tokens.length && tokens.every((tk) => tClean.includes(tk))) return true;
        if (domainUsable) {
          const emails = fathomMeetingEmails(m);
          if (emails.some((e) => e.endsWith("@" + domain))) return true;
        }
        return false;
      });

      if (!matches.length) {
        report.push({ org_id: org.id, client: c.name, meetings_found: 0, meetings_added: 0, meetings_skipped: 0, insights_run: false });
        continue;
      }

      const { data: existing } = await admin
        .from("client_meetings").select("recording_link").eq("client_id", c.id);
      const have = new Set((existing ?? []).map((r) => (r.recording_link as string | null) ?? "").filter(Boolean));

      let added = 0, skipped = 0;
      for (const m of matches) {
        const link = m.share_url || m.url || "";
        if (!link) { skipped++; continue; }
        if (have.has(link)) { skipped++; continue; }
        const notes = fathomMeetingNotes(m);
        const when = m.scheduled_start_time || m.meeting_time || m.created_at || null;
        const { error } = await admin.from("client_meetings").insert({
          org_id: org.id,
          client_id: c.id,
          title: m.title || m.meeting_title || `${c.name} — call`,
          meeting_date: when ? new Date(when).toISOString().slice(0, 10) : null,
          recording_link: link,
          notes: notes || null,
          summary: null,
          source: "fathom",
          created_by: "backfill",
        });
        if (error) { skipped++; continue; }
        added++;
      }

      // Pick the latest meeting (by scheduled_start_time desc) and extract insights from it.
      const latest = [...matches].sort((a, b) => {
        const ta = new Date(a.scheduled_start_time || a.meeting_time || a.created_at || 0).getTime();
        const tb = new Date(b.scheduled_start_time || b.meeting_time || b.created_at || 0).getTime();
        return tb - ta;
      })[0];
      const latestLink = latest?.share_url || latest?.url || "";
      const latestNotes = latest ? fathomMeetingNotes(latest) : "";
      let insightsRun = false;
      let insightsErr: string | undefined;
      if (latestNotes.trim()) {
        // _extractInsightsForClient writes call_link / call_notes / call_summary
        // / pain_points / business_description / structured columns / facts /
        // call_insights sections — all in one go.
        const r = await _extractInsightsForClient(org.id, c.id, latestLink, latestNotes).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "ai failed" }));
        if ("error" in r && r.error) insightsErr = r.error; else insightsRun = true;
      }
      report.push({ org_id: org.id, client: c.name, meetings_found: matches.length, meetings_added: added, meetings_skipped: skipped, insights_run: insightsRun, insights_error: insightsErr });
    }
  }

  return NextResponse.json({ ok: true, total_clients: report.length, processed: report });
}
