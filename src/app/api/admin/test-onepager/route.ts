import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai";

// One-shot admin endpoint to generate + return a one-pager for a given runId.
// Secured by CRON_SECRET. Usage: GET /api/admin/test-onepager?runId=<id>
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const admin = createAdminClient();

  // Return cached if available
  const { data: existing } = await admin.from("run_items").select("data,created_at").eq("run_id", runId).eq("kind", "onepager").maybeSingle();
  if (existing) return NextResponse.json({ cached: true, ...existing.data, savedAt: existing.created_at });

  const { data: run } = await admin.from("onboarding_runs").select("client_id,org_id").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const { data: client } = await admin.from("clients").select("name,owner_name,industry,reg_facts,vat_registered,ct_registered,entity_type").eq("id", run.client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  // Compliance calendar
  const { data: compRows } = await admin.from("run_items").select("data").eq("run_id", runId).eq("kind", "compliance");
  const compliance = (compRows ?? []).map((r) => r.data as { label?: string; type?: string; date?: string }).filter((x) => x?.date);

  // Contract
  const { data: contractRow } = await admin.from("run_items").select("data").eq("run_id", runId).eq("kind", "contract").maybeSingle();
  const contract = (contractRow?.data as { deliverables?: { deadline?: string }[]; periodStart?: string; reportingFrequency?: string } | null) ?? null;
  let firstDelivery = "";
  if (contract?.deliverables?.[0]?.deadline) firstDelivery = contract.deliverables[0].deadline;
  else if (contract?.periodStart) firstDelivery = `Starts ${contract.periodStart}${contract.reportingFrequency ? ` (${contract.reportingFrequency} cadence)` : ""}`;

  // Team
  const { data: teamRows } = await admin.from("run_team").select("role_in_run,team_members(full_name,email,role)").eq("run_id", runId);
  type TeamRow = { role_in_run: string; team_members: { full_name: string; email?: string; role?: string } | { full_name: string; email?: string; role?: string }[] | null };
  const team = (teamRows ?? []).map((t: TeamRow) => {
    const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
    return tm ? { role: t.role_in_run, name: tm.full_name, email: (tm as { email?: string }).email ?? "" } : null;
  }).filter(Boolean) as { role: string; name: string; email: string }[];

  // Uploaded documents
  const { data: docRows } = await admin.from("documents").select("label,status").eq("client_id", run.client_id);
  const uploadedDocs = (docRows ?? []).filter((d) => d.status === "uploaded" || d.status === "received").map((d) => d.label as string);

  const reg = (client.reg_facts as { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string } | null) ?? {};

  const ctx = `Client: ${client.name}; owner ${client.owner_name ?? "n/a"}; industry ${client.industry ?? "n/a"}; entity ${client.entity_type ?? "n/a"}; VAT ${client.vat_registered ? "registered" : "not registered"}; CT ${client.ct_registered ? "registered" : "not registered"}.\n` +
    `UAE registration facts: incorporation ${reg.incorporationDate ?? "n/a"}; trade licence expiry ${reg.tradeLicenceExpiry ?? "n/a"}; VAT first filing ${reg.vatFirstFiling ?? "n/a"}; CT first filing ${reg.ctFirstFiling ?? "n/a"}.\n` +
    `First delivery: ${firstDelivery || "to be confirmed once data is in"}.\n` +
    `Assigned team: ${team.length ? team.map((t) => `${t.role}: ${t.name}${t.email ? ` <${t.email}>` : ""}`).join("; ") : "team not yet assigned"}.\n` +
    `Documents received from client: ${uploadedDocs.length ? uploadedDocs.join(", ") : "none uploaded yet"}.\n` +
    `Compliance calendar items: ${compliance.length ? compliance.map((c) => `${c.label} (${c.type}) due ${c.date}`).join("; ") : "none extracted yet"}.`;

  const text = await runAi(run.org_id, "handover_summary", {
    runId,
    system: "You write polished client-facing one-pagers for a UAE accounting firm called Finanshels (www.finanshels.com). Finanshels is a modern UAE accounting firm known for tech-forward, proactive service. Output plain text only — no markdown, no headings with #, no asterisks. Use only the details given; never invent. Where documents are listed, mention they have been received to reassure the client.",
    prompt:
      `Write a tight one-pager that summarises everything the client needs to know after onboarding completes — for the AM to share before recurring delivery starts. Sections in order:\n` +
      `1) Compliance calendar — the next 12 months of UAE filings & expiries (bullet list). If no items provided, write "We will set up your compliance calendar once your VAT/CT registration details are confirmed."\n` +
      `2) First delivery date — when the first report will land.\n` +
      `3) Documents received — list the documents the client has already submitted (shows progress and builds trust). Omit if none.\n` +
      `4) Your Finanshels team — names + roles + emails.\n` +
      `5) UAE compliance details — incorporation, trade licence expiry, VAT & CT first filings. Omit lines that are "n/a".\n\n` +
      `Keep it under 400 words. Warm, professional, Finanshels brand voice — tech-forward UAE accounting firm. No jargon.\n\nDetails:\n${ctx}`,
  });

  const generatedAt = new Date().toISOString();
  const sections = [
    { heading: "Compliance calendar", items: compliance.map((c) => `${c.label} — ${c.date}${c.type ? ` (${c.type})` : ""}`) },
    { heading: "First delivery", items: firstDelivery ? [firstDelivery] : ["To be confirmed once data is in."] },
    ...(uploadedDocs.length ? [{ heading: "Documents received", items: uploadedDocs }] : []),
    { heading: "Your Finanshels team", items: team.map((t) => `${t.role.toUpperCase()} — ${t.name}${t.email ? ` · ${t.email}` : ""}`) },
    { heading: "UAE compliance details", items: [
      reg.incorporationDate ? `Incorporation: ${reg.incorporationDate}` : null,
      reg.tradeLicenceExpiry ? `Trade licence expires: ${reg.tradeLicenceExpiry}` : null,
      reg.vatFirstFiling ? `VAT — first filing: ${reg.vatFirstFiling}` : null,
      reg.ctFirstFiling ? `Corporate Tax — first filing: ${reg.ctFirstFiling}` : null,
    ].filter(Boolean) as string[] },
  ];

  const payload = { generated: text, sections, generatedAt, notes: "" };
  await admin.from("run_items").insert({ run_id: runId, client_id: run.client_id, kind: "onepager", data: payload });

  return NextResponse.json({ cached: false, generated: text, sections, generatedAt, context: ctx });
}
