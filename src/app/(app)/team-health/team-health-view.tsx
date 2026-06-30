"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { runAutoPoints, awardManualPoints } from "./actions";

export interface HealthMember {
  id: string;
  full_name: string;
  title: string | null;
  role: string;
  dept: string | null;
  reports_to: string | null;
  avatar_initials: string | null;
  avatar_color: string | null;
  points: number;
  openTasks: { id: string; title: string; isRecurring: boolean }[];
  health: "green" | "yellow" | "red";
}

interface RecentPoint {
  id: string;
  member_id: string;
  points: number;
  reason: string;
  source: string;
  created_at: string;
}

interface Props {
  members: HealthMember[];
  recentPoints: RecentPoint[];
  isAdmin: boolean;
}

const HEALTH_PILL: Record<string, string> = {
  green: "var(--c-success, #22c55e)",
  yellow: "var(--c-warning, #f59e0b)",
  red: "var(--c-danger, #ef4444)",
};

const ROLE_TIERS: Record<string, number> = {
  ops_head: 0, admin: 0,
  am: 1,
  team_lead: 2, senior: 2,
  junior: 3,
  associate: 4, intern: 4, other: 4,
};

function Avatar({ m }: { m: Pick<HealthMember, "avatar_initials" | "avatar_color" | "full_name"> }) {
  const bg = m.avatar_color ?? "#6366f1";
  const initials = m.avatar_initials ?? m.full_name.slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 600, color: "#fff", flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function HealthPill({ health }: { health: "green" | "yellow" | "red" }) {
  const label = health === "green" ? "Healthy" : health === "yellow" ? "Watch" : "At Risk";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 99,
      background: HEALTH_PILL[health] + "22",
      color: HEALTH_PILL[health],
      fontSize: 11, fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function MemberCard({ m, allMembers }: { m: HealthMember; allMembers: HealthMember[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: "1px solid var(--c-border, #e5e7eb)", borderRadius: 10,
      background: "var(--c-surface, #fff)", overflow: "hidden",
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <Avatar m={m} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{m.full_name}</div>
          <div style={{ fontSize: 11, color: "var(--c-muted, #6b7280)" }}>{m.title ?? m.role}</div>
        </div>
        <HealthPill health={m.health} />
        <span style={{
          fontWeight: 700, fontSize: 13,
          color: m.points >= 0 ? "var(--c-success, #22c55e)" : "var(--c-danger, #ef4444)",
          minWidth: 36, textAlign: "right",
        }}>
          {m.points >= 0 ? "+" : ""}{m.points}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--c-muted)" }} />
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--c-border, #e5e7eb)", padding: "12px 14px" }}>
          {m.openTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--c-muted, #6b7280)", margin: 0 }}>No open action items.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {m.openTasks.map(t => (
                <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12 }}>
                  <Icon
                    name={t.isRecurring ? "alert-triangle" : "circle-dot"}
                    size={13}
                    style={{ color: t.isRecurring ? "var(--c-danger, #ef4444)" : "var(--c-muted, #6b7280)", marginTop: 1, flexShrink: 0 }}
                  />
                  <span style={{ color: t.isRecurring ? "var(--c-danger, #ef4444)" : "inherit" }}>
                    {t.title}{t.isRecurring && " (recurring overdue)"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AMGroup {
  am: HealthMember | null;
  amId: string | null;
  amLabel: string;
  seniors: HealthMember[];
  juniors: HealthMember[];
  interns: HealthMember[];
  others: HealthMember[];
}

function buildGroups(members: HealthMember[]): AMGroup[] {
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const opsHeads = members.filter(m => m.role === "ops_head" || m.role === "admin");
  const ams = members.filter(m => m.role === "am");

  function directOf(parentId: string | null): HealthMember[] {
    return members.filter(m => m.reports_to === parentId);
  }

  function buildAMGroup(am: HealthMember | null, amId: string | null, label: string): AMGroup {
    const reports = directOf(amId);
    return {
      am, amId, amLabel: label,
      seniors: reports.filter(m => ["senior", "team_lead"].includes(m.role)),
      juniors: reports.filter(m => m.role === "junior"),
      interns: reports.filter(m => ["associate", "intern"].includes(m.role)),
      others: reports.filter(m => !["senior", "team_lead", "junior", "associate", "intern"].includes(m.role)),
    };
  }

  const groups: AMGroup[] = [];

  // If there's an ops head, AMs report to them; collect AMs under opsHead
  const opsHead = opsHeads[0] ?? null;
  const opsHeadId = opsHead?.id ?? null;

  // AMs that report to opsHead (or have no reports_to which means top-level AM)
  const topAMs = ams.filter(m => m.reports_to === opsHeadId || m.reports_to == null);

  // If no AMs found at all, put all non-opsHead members in one group
  if (topAMs.length === 0) {
    const allWorkers = members.filter(m => !["ops_head", "admin"].includes(m.role));
    groups.push({
      am: null, amId: null, amLabel: "All Team",
      seniors: allWorkers.filter(m => ["senior", "team_lead"].includes(m.role)),
      juniors: allWorkers.filter(m => m.role === "junior"),
      interns: allWorkers.filter(m => ["associate", "intern"].includes(m.role)),
      others: allWorkers.filter(m => !["senior", "team_lead", "junior", "associate", "intern"].includes(m.role)),
    });
  } else {
    for (const am of topAMs) {
      groups.push(buildAMGroup(am, am.id, am.full_name));
    }
    // Members that don't report to any AM
    const coveredIds = new Set(topAMs.flatMap(am => directOf(am.id).map(m => m.id)));
    const unassigned = members.filter(m =>
      !["ops_head", "admin", "am"].includes(m.role) && !coveredIds.has(m.id)
    );
    if (unassigned.length) {
      groups.push({
        am: null, amId: null, amLabel: "Unassigned",
        seniors: unassigned.filter(m => ["senior", "team_lead"].includes(m.role)),
        juniors: unassigned.filter(m => m.role === "junior"),
        interns: unassigned.filter(m => ["associate", "intern"].includes(m.role)),
        others: unassigned.filter(m => !["senior", "team_lead", "junior", "associate", "intern"].includes(m.role)),
      });
    }
  }

  return groups;
}

function TierSection({ label, members, allMembers }: { label: string; members: HealthMember[]; allMembers: HealthMember[] }) {
  if (!members.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map(m => <MemberCard key={m.id} m={m} allMembers={allMembers} />)}
      </div>
    </div>
  );
}

export function TeamHealthView({ members, recentPoints, isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [autoResult, setAutoResult] = useState<string | null>(null);
  const [awardTarget, setAwardTarget] = useState("");
  const [awardPts, setAwardPts] = useState(0);
  const [awardReason, setAwardReason] = useState("");

  const groups = useMemo(() => buildGroups(members), [members]);

  // Leaderboard: sort by points desc
  const leaderboard = useMemo(
    () => [...members].sort((a, b) => b.points - a.points).slice(0, 10),
    [members]
  );

  // Name lookup for recent points feed
  const nameById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m.full_name])), [members]);

  function handleRunAuto() {
    startTransition(async () => {
      try {
        const r = await runAutoPoints();
        setAutoResult(`Week ${r.week}: ${r.awarded} point events awarded.`);
      } catch (e: any) {
        setAutoResult(`Error: ${e.message}`);
      }
    });
  }

  function handleManualAward() {
    if (!awardTarget || !awardReason) return;
    startTransition(async () => {
      try {
        await awardManualPoints(awardTarget, awardPts, awardReason);
        setAwardTarget(""); setAwardPts(0); setAwardReason("");
        setAutoResult("Points awarded.");
      } catch (e: any) {
        setAutoResult(`Error: ${e.message}`);
      }
    });
  }

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 1100, display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, alignItems: "start" }}>

        {/* ── Left: AM groups ─────────────────────────────────────────────── */}
        <div>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Team Health</h1>
            <p style={{ fontSize: 13, color: "var(--c-muted, #6b7280)", margin: "4px 0 0" }}>
              Action items, health status, and points — organised by Account Manager.
            </p>
          </div>

          {groups.map((g, gi) => (
            <div key={gi} style={{
              marginBottom: 28,
              border: "1px solid var(--c-border, #e5e7eb)",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              {/* AM header */}
              <div style={{
                padding: "14px 16px",
                background: "var(--c-surface-raised, #f9fafb)",
                borderBottom: "1px solid var(--c-border, #e5e7eb)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                {g.am ? <Avatar m={g.am} /> : (
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 600, color: "#fff",
                  }}>—</div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{g.amLabel}</div>
                  {g.am && <div style={{ fontSize: 11, color: "var(--c-muted, #6b7280)" }}>Account Manager</div>}
                </div>
                {g.am && <HealthPill health={g.am.health} />}
                {g.am && (
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: g.am.points >= 0 ? "var(--c-success, #22c55e)" : "var(--c-danger, #ef4444)",
                  }}>
                    {g.am.points >= 0 ? "+" : ""}{g.am.points} pts
                  </span>
                )}
              </div>

              <div style={{ padding: 14 }}>
                <TierSection label="Seniors / Team Leads" members={g.seniors} allMembers={members} />
                <TierSection label="Juniors" members={g.juniors} allMembers={members} />
                <TierSection label="Interns / Associates" members={g.interns} allMembers={members} />
                <TierSection label="Other" members={g.others} allMembers={members} />
              </div>
            </div>
          ))}
        </div>

        {/* ── Right: Sidebar ───────────────────────────────────────────────── */}
        <div style={{ position: "sticky", top: 20, display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Points leaderboard */}
          <div style={{ border: "1px solid var(--c-border, #e5e7eb)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", background: "var(--c-surface-raised, #f9fafb)", borderBottom: "1px solid var(--c-border, #e5e7eb)", fontWeight: 600, fontSize: 13 }}>
              Points Leaderboard
            </div>
            <div style={{ padding: "8px 0" }}>
              {leaderboard.map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
                  <span style={{ width: 18, fontSize: 11, fontWeight: 700, color: i < 3 ? "#f59e0b" : "var(--c-muted, #6b7280)", textAlign: "right" }}>
                    {i + 1}
                  </span>
                  <Avatar m={m} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{m.full_name.split(" ")[0]}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: m.points >= 0 ? "var(--c-success, #22c55e)" : "var(--c-danger, #ef4444)",
                  }}>
                    {m.points >= 0 ? "+" : ""}{m.points}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div style={{ border: "1px solid var(--c-border, #e5e7eb)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", background: "var(--c-surface-raised, #f9fafb)", borderBottom: "1px solid var(--c-border, #e5e7eb)", fontWeight: 600, fontSize: 13 }}>
              Recent Activity
            </div>
            <div style={{ padding: "8px 0", maxHeight: 220, overflowY: "auto" }}>
              {recentPoints.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--c-muted, #6b7280)", padding: "8px 14px", margin: 0 }}>No points yet.</p>
              )}
              {recentPoints.map(p => (
                <div key={p.id} style={{ padding: "5px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {nameById[p.member_id] ?? "—"}
                    <span style={{ color: p.points >= 0 ? "var(--c-success, #22c55e)" : "var(--c-danger, #ef4444)", marginLeft: 4 }}>
                      {p.points >= 0 ? "+" : ""}{p.points}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--c-muted, #6b7280)" }}>{p.reason}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Admin controls */}
          {isAdmin && (
            <div style={{ border: "1px solid var(--c-border, #e5e7eb)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", background: "var(--c-surface-raised, #f9fafb)", borderBottom: "1px solid var(--c-border, #e5e7eb)", fontWeight: 600, fontSize: 13 }}>
                Admin Controls
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={handleRunAuto}
                  disabled={isPending}
                  style={{
                    width: "100%", padding: "8px 0", borderRadius: 8,
                    background: "var(--c-primary, #6366f1)", color: "#fff",
                    border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                    opacity: isPending ? 0.6 : 1,
                  }}
                >
                  {isPending ? "Running…" : "Run Auto-Points Now"}
                </button>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <select
                    value={awardTarget}
                    onChange={e => setAwardTarget(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border, #e5e7eb)", fontSize: 12, width: "100%" }}
                  >
                    <option value="">Select member…</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="number"
                      value={awardPts}
                      onChange={e => setAwardPts(Number(e.target.value))}
                      placeholder="Points"
                      style={{ width: 70, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border, #e5e7eb)", fontSize: 12 }}
                    />
                    <input
                      value={awardReason}
                      onChange={e => setAwardReason(e.target.value)}
                      placeholder="Reason"
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border, #e5e7eb)", fontSize: 12 }}
                    />
                  </div>
                  <button
                    onClick={handleManualAward}
                    disabled={isPending || !awardTarget || !awardReason}
                    style={{
                      width: "100%", padding: "7px 0", borderRadius: 8,
                      background: "var(--c-surface-raised, #f9fafb)",
                      border: "1px solid var(--c-border, #e5e7eb)",
                      cursor: "pointer", fontSize: 12, fontWeight: 600,
                      opacity: isPending || !awardTarget || !awardReason ? 0.5 : 1,
                    }}
                  >
                    Award Points
                  </button>
                </div>

                {autoResult && (
                  <p style={{ fontSize: 11, color: "var(--c-muted, #6b7280)", margin: 0 }}>{autoResult}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
