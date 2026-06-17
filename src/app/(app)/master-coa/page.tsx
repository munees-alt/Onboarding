import { requireSession } from "@/lib/auth";
import { Restricted } from "@/components/restricted";
import { canManageCoa } from "@/lib/roles";
import { getMasterCoas } from "@/lib/master-coa";
import { MasterCoaView } from "./master-coa-view";

export default async function MasterCoaPage() {
  const s = await requireSession();
  const role = s.teamMember?.role ?? s.profile.role;
  if (!canManageCoa(role) || !s.profile.org_id) return <Restricted message="The Master COA library is managed by the Master Admin, Ops Head and Account Managers." />;
  const coas = await getMasterCoas(s.profile.org_id);
  return <MasterCoaView coas={coas} />;
}
