import { requireSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { notFound } from "next/navigation";
import { getAmWeeklyReport } from "./actions";
import { AmReportView } from "./am-report-view";
import type { Role } from "@/lib/types";

export default async function AmReportPage() {
  const session = await requireSession();
  const role = (session.teamMember?.role ?? session.profile?.role ?? "") as Role;
  // Admin / Ops Head / AM / Team Lead can view; each sees their own scope (handled in action).
  const allowed = isMasterAdmin(role) || role === "am" || role === "ops_head" || role === "team_lead";
  if (!allowed) notFound();

  const result = await getAmWeeklyReport();
  return (
    <AmReportView
      ams={result.ams}
      generatedAt={result.generatedAt}
      viewerRole={result.viewerRole}
      viewerName={result.viewerName}
      loadError={result.error ?? null}
    />
  );
}
