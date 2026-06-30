import { requireSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { notFound } from "next/navigation";
import { getAmWeeklyReport } from "./actions";
import { AmReportView } from "./am-report-view";
import type { Role } from "@/lib/types";

export default async function AmReportPage() {
  const session = await requireSession();
  const role = (session.teamMember?.role ?? session.profile?.role ?? "") as Role;
  // Visible to master admin and AMs (AMs see their own clients only, handled in action)
  if (!isMasterAdmin(role) && role !== "am" && role !== "ops_head") notFound();

  const { ams, generatedAt, error } = await getAmWeeklyReport();
  return <AmReportView ams={ams} generatedAt={generatedAt} loadError={error ?? null} />;
}
