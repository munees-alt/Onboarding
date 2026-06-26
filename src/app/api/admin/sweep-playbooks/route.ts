import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { _extractInsightsForClient } from "@/app/(app)/clients/actions";
import { _generateComplianceFromDocsImpl } from "@/app/(app)/onboarding/[runId]/ai-actions";

// Bigger upload + longer execution — Drive scans can take a while per client.
export const maxDuration = 300;

/**
 * Nightly playbook sweep — for every onboarded client, fills any blank
 * playbook field from the sources we already have access to:
 *
 *   • Fathom + meeting notes  →  business_description, pain_points, banks,
 *                                payment_gateways, accounting_software,
 *                                vat_registered, ct_registered, revenue, …
 *
 *   • Drive "Company Documents" folder  →  reg_facts (incorporation date,
 *     trade-licence expiry, VAT first filing, CT first filing) + the full
 *     compliance calendar (doc expiries + statutory VAT/CT deadlines).
 *
 * Idempotent — only fills BLANK fields, never overwrites manually-edited
 * values. Wired to a Vercel cron in vercel.json. Also callable manually
 * by sending CRON_SECRET as a Bearer token.
 *
 * Query params:
 *   ?force=1           — rebuild compliance even if reg_facts already set
 *   ?clientId=<uuid>   — limit the sweep to a single client (debug)
 *   ?max=<n>           — cap the number of clients processed this run
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const onlyClientId = url.searchParams.get("clientId") || null;
  const cap = Math.max(0, parseInt(url.searchParams.get("max") ?? "0", 10) || 0);

  const admin = createAdminClient();
  let cQ = admin
    .from("clients")
    .select("id,org_id,name,status,owner_name,primary_contact_email,industry,entity_type,business_description,pain_points,vat_registered,ct_registered,bank_names,payment_gateways,accounting_software,revenue_channels,call_insights,reg_facts")
    .in("status", ["onboarding", "active", "signed"])
    .order("name");
  if (onlyClientId) cQ = cQ.eq("id", onlyClientId);
  const { data: clients } = await cQ;
  const targets = (clients ?? []).slice(0, cap > 0 ? cap : Infinity);

  type ClientReport = {
    clientId: string;
    name: string;
    filledFromMeetings: string[];
    filledFromDrive: string[];
    complianceItems: number;
    complianceEmpty: boolean;
    stillBlank: string[];
    errors: string[];
  };
  const report: ClientReport[] = [];

  const isBlank = (v: unknown): boolean => {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return !Object.keys(v).length;
    return String(v).trim() === "";
  };

  for (const c of targets) {
    const r: ClientReport = {
      clientId: c.id as string,
      name: c.name as string,
      filledFromMeetings: [],
      filledFromDrive: [],
      complianceItems: 0,
      complianceEmpty: false,
      stillBlank: [],
      errors: [],
    };

    // ── 1) Meeting / Fathom extraction ──────────────────────────────────
    // Only when call_insights is blank — we never overwrite the AM's work.
    if (isBlank(c.call_insights)) {
      const { data: meetings } = await admin
        .from("client_meetings")
        .select("recording_link,notes")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false });
      const withSomething = (meetings ?? []).find((m) => (m.notes && String(m.notes).trim()) || (m.recording_link && String(m.recording_link).trim()));
      if (withSomething) {
        const before = { ...c };
        try {
          const res = await _extractInsightsForClient(
            c.org_id as string,
            c.id as string,
            (withSomething.recording_link as string | null) ?? "",
            (withSomething.notes as string | null) ?? "",
          );
          if (res.error) {
            r.errors.push(`call-insights: ${res.error}`);
          } else {
            // Re-read the client to see what changed.
            const { data: after } = await admin
              .from("clients")
              .select("owner_name,primary_contact_email,entity_type,business_description,pain_points,vat_registered,ct_registered,bank_names,payment_gateways,accounting_software,revenue_channels,call_insights")
              .eq("id", c.id)
              .maybeSingle();
            if (after) {
              const CHECK: (keyof typeof after)[] = [
                "owner_name", "primary_contact_email", "entity_type", "business_description",
                "pain_points", "vat_registered", "ct_registered", "bank_names",
                "payment_gateways", "accounting_software", "revenue_channels", "call_insights",
              ];
              for (const k of CHECK) {
                if (isBlank((before as Record<string, unknown>)[k]) && !isBlank(after[k])) r.filledFromMeetings.push(k);
              }
              // Reflect the updates locally so the "still blank" check is accurate.
              Object.assign(c, after);
            }
          }
        } catch (err) {
          r.errors.push(`call-insights threw: ${err instanceof Error ? err.message : "unknown"}`);
        }
      }
    }

    // ── 2) Drive scan → reg_facts + compliance calendar ─────────────────
    // Always run when reg_facts is blank; also run on force=1.
    if (isBlank(c.reg_facts) || force) {
      const { data: runs } = await admin
        .from("onboarding_runs")
        .select("id,status,created_at,template_key")
        .eq("client_id", c.id)
        .neq("template_key", "lead-intake")
        .order("created_at", { ascending: false });
      const target =
        (runs ?? []).find((rr) => !["complete", "closed", "archived"].includes(rr.status as string)) ??
        (runs ?? []).find((rr) => rr.status !== "archived") ??
        (runs ?? [])[0];
      if (!target) {
        r.errors.push("drive: no onboarding run for this client");
      } else {
        try {
          const res = await _generateComplianceFromDocsImpl(c.org_id as string, target.id as string);
          if (res.error) {
            r.errors.push(`drive: ${res.error}`);
          } else if (res.empty) {
            r.complianceEmpty = true;
          } else {
            const items = res.items ?? [];
            r.complianceItems = items.length;
            // Persist compliance items the same way saveRunItems does.
            await admin.from("run_items").delete().eq("run_id", target.id).eq("kind", "compliance");
            if (items.length) {
              await admin.from("run_items").insert(
                items.map((it, i) => ({
                  run_id: target.id,
                  client_id: c.id,
                  kind: "compliance",
                  data: { ...it, reminderDays: it.reminderDays ?? 30 },
                  status: "open",
                  sort: i,
                })),
              );
            }
            // Read back the client to capture any reg_facts written by the Drive scan.
            const { data: after } = await admin.from("clients").select("reg_facts").eq("id", c.id).maybeSingle();
            if (after && !isBlank(after.reg_facts) && isBlank(c.reg_facts)) {
              r.filledFromDrive.push("reg_facts");
              (c as Record<string, unknown>).reg_facts = after.reg_facts;
            }
          }
        } catch (err) {
          r.errors.push(`drive threw: ${err instanceof Error ? err.message : "unknown"}`);
        }
      }
    }

    // ── 3) Final blanks (reflected after writes) ────────────────────────
    const FIELDS: { key: keyof typeof c; label: string }[] = [
      { key: "owner_name", label: "Owner name" },
      { key: "primary_contact_email", label: "Primary email" },
      { key: "industry", label: "Industry" },
      { key: "entity_type", label: "Entity type" },
      { key: "business_description", label: "Business description" },
      { key: "pain_points", label: "Pain points" },
      { key: "vat_registered", label: "VAT registered" },
      { key: "ct_registered", label: "CT registered" },
      { key: "bank_names", label: "Banks" },
      { key: "payment_gateways", label: "Payment gateways" },
      { key: "accounting_software", label: "Accounting software" },
      { key: "revenue_channels", label: "Revenue channels" },
      { key: "call_insights", label: "Call insights" },
      { key: "reg_facts", label: "Registration facts" },
    ];
    for (const f of FIELDS) {
      if (isBlank((c as Record<string, unknown>)[f.key as string])) r.stillBlank.push(f.label);
    }

    report.push(r);
  }

  const sum = {
    clients: targets.length,
    filledFromMeetings: report.reduce((n, r) => n + r.filledFromMeetings.length, 0),
    filledFromDrive: report.reduce((n, r) => n + r.filledFromDrive.length, 0),
    complianceItems: report.reduce((n, r) => n + r.complianceItems, 0),
    complianceEmpty: report.filter((r) => r.complianceEmpty).length,
    errored: report.filter((r) => r.errors.length).length,
  };

  return NextResponse.json({ ok: true, summary: sum, report });
}
