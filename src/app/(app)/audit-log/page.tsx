import { requireSession } from "@/lib/auth";
import { canOpenAudit } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icon";

const ACTION_ICON: Record<string, string> = {
  run_created: "play",
  role_switched: "user-cog",
  route_changed: "navigation",
};

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function AuditLogPage() {
  const s = await requireSession();
  if (!canOpenAudit(s.profile.role))
    return <Restricted message="The audit log is only visible to the Master Admin and Ops Head." />;

  const supabase = await createClient();
  const { data: events } = await supabase
    .from("audit_events")
    .select("actor,actor_role,action,module,resource_ref,resource_type,created_at")
    .eq("org_id", s.profile.org_id)
    .order("created_at", { ascending: false })
    .limit(150);

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="section-head">
          <div>
            <h2>Audit Log</h2>
            <div className="sub">Every action across Cadence — newest first.</div>
          </div>
          <span className="right-pill"><span className="dot" /> {events?.length ?? 0} events</span>
        </div>

        <div className="runs-card">
          {!events?.length ? (
            <div style={{ padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              No events yet. Actions like creating a run or signing off appear here.
            </div>
          ) : (
            <div>
              {events.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < events.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg)", color: "var(--ink-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name={ACTION_ICON[e.action] ?? "activity"} size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--ink-1)" }}>{e.resource_ref ?? e.action}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{e.actor ?? "System"}{e.actor_role ? ` · ${e.actor_role}` : ""}{e.module ? ` · ${e.module}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--ink-4)", flexShrink: 0 }}>{ago(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
