import { requireSession } from "@/lib/auth";
import { canOpenOrgChart } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createClient } from "@/lib/supabase/server";
import { getAccessMatrix, resolveNavAccess } from "@/lib/role-access";
import { OrgChartView, type OrgMember } from "./org-chart-view";

export default async function OrgChartPage() {
  const s = await requireSession();
  const matrix = s.profile.org_id ? await getAccessMatrix(s.profile.org_id) : null;
  const hasAccess = matrix
    ? resolveNavAccess(matrix, { role: s.profile.role, memberId: s.teamMember?.id ?? null, dept: s.teamMember?.dept ?? null }, "org-chart", canOpenOrgChart(s.profile.role))
    : canOpenOrgChart(s.profile.role);
  if (!hasAccess)
    return <Restricted message="The org chart is only visible to the Ops Head and Master Admin." />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("id,full_name,email,title,role,dept,location,reports_to,avatar_initials,avatar_color")
    .eq("org_id", s.profile.org_id)
    .eq("active", true)
    .order("sort");

  return <OrgChartView members={(data ?? []) as OrgMember[]} />;
}
