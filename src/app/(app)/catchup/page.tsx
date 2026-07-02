import { renderAuditLiquidationSection } from "../audit-liquidation/page";

export default async function CatchupPage() {
  return renderAuditLiquidationSection("catchup", "catchup");
}
