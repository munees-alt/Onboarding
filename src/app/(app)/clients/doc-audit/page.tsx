import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DocAuditView } from "./doc-audit-view";

export default async function DocAuditPage() {
  const session = await getSession();
  if (!session?.profile.org_id) redirect("/login");
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["admin", "ops_head", "am"].includes(role)) {
    return <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>Access restricted.</div>;
  }
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Document Audit</h1>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-3)" }}>
          Scans Drive + portal documents for each active client and flags missing required docs: Trade Licence, MOA, EID/Passport, Incorporation Certificate.
        </p>
      </div>
      <DocAuditView />
    </div>
  );
}
