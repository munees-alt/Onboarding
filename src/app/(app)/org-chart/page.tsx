import { requireSession } from "@/lib/auth";
import { canOpenOrgChart } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createClient } from "@/lib/supabase/server";
import { OrgChartView, type OrgMember } from "./org-chart-view";

export default async function OrgChartPage() {
  const s = await requireSession();
  if (!canOpenOrgChart(s.profile.role))
    return <Restricted message="The org chart is only visible to the Ops Head and Master Admin." />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("id,full_name,email,title,role,dept,location,reports_to,avatar_initials,avatar_color")
    .eq("org_id", s.profile.org_id)
    .order("sort");

  return <OrgChartView members={(data ?? []) as OrgMember[]} />;
}
