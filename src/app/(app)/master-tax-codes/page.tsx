import { requireSession } from "@/lib/auth";
import { Restricted } from "@/components/restricted";
import { canManageCoa } from "@/lib/roles";
import { ensureSeedTaxCodes, getTaxCodeSets } from "@/lib/tax-codes";
import { MasterTaxCodesView } from "./master-tax-codes-view";

export default async function MasterTaxCodesPage() {
  const s = await requireSession();
  const role = s.teamMember?.role ?? s.profile.role;
  if (!canManageCoa(role) || !s.profile.org_id) {
    return <Restricted message="Tax codes are managed by the Master Admin, Ops Head and Account Managers." />;
  }
  await ensureSeedTaxCodes(s.profile.org_id);
  const sets = await getTaxCodeSets(s.profile.org_id);
  return <MasterTaxCodesView sets={sets} />;
}
