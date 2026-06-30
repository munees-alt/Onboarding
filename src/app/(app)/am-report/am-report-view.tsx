"use client";

import { useState } from "react";
import Link from "next/link";
import type { AmReportEntry, AmReportClient, AmReportTask, PersonNode, TeamLeadNode, ActionItem } from "./actions";
import type { Role } from "@/lib/types";

type TaskFilter = "all" | "open" | "overdue" | "done";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    complete:    { label: "Done",        bg: "#dcfce7", color: "#15803d" },
    in_progress: { label: "In Progress", bg: "#fef9c3", color: "#92400e" },
    not_started: { label: "Not Started", bg: "#f1f5f9", color: "#475569" },
    blocked:     { label: "Blocked",     bg: "#fee2e2", color: "#b91c1c" },
  };
  const s = map[status] ?? { label: status, bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function ActionItemsPanel({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 14, border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e", flex: 1 }}>
          Action items
        </span>
        <span style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 20, padding: "2px 8px", fontWeight: 700 }}>
          {items.length} open
        </span>
        <span style={{ fontSize: 11, color: "#a16207" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "8px 14px 12px", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Title</th>
                <th style={{ padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Kind</th>
                <th style={{ padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Client</th>
                <th style={{ padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "#64748b", textAlign: "left", whiteSpace: "nowrap" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "7px 8px", fontSize: 13, color: "var(--ink-1, #111)" }}>
                    <div style={{ fontWeight: 600 }}>{a.title}</div>
                    {a.body && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>{a.body.length > 200 ? a.body.slice(0, 200) + "…" : a.body}</div>}
                  </td>
                  <td style={{ padding: "7px 8px", fontSize: 11, color: "#475569", whiteSpace: "nowrap" }}>
                    <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4, fontSize: 10.5 }}>{a.kind}</code>
                  </td>
                  <td style={{ padding: "7px 8px", fontSize: 12 }}>
                    {a.clientName ? (
                      <Link href={`/clients/${a.clientId}`} style={{ color: "#0369a1", textDecoration: "none" }}>{a.clientName}</Link>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "7px 8px", fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{fmtTimestamp(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: AmReportTask }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td style={{ padding: "7px 10px", fontSize: 13, color: task.overdue ? "#b91c1c" : "var(--ink-1, #111)" }}>
        {task.title}
        {task.overdue && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", borderRadius: 4, padding: "1px 5px" }}>OVERDUE</span>}
      </td>
      <td style={{ padding: "7px 10px" }}><StatusPill status={task.status} /></td>
      <td style={{ padding: "7px 10px", fontSize: 12, color: "var(--ink-3, #64748b)" }}>{task.boardColumn ?? "—"}</td>
      <td style={{ padding: "7px 10px", fontSize: 12, color: "var(--ink-3, #64748b)" }}>{task.ownerName ?? (task.ownerKind === "client" ? "Client" : "—")}</td>
      <td style={{ padding: "7px 10px", fontSize: 12, color: task.overdue ? "#b91c1c" : "var(--ink-3, #64748b)", whiteSpace: "nowrap" }}>{fmtDate(task.dueDate)}</td>
    </tr>
  );
}

function ClientSection({ client, taskFilter }: { client: AmReportClient; taskFilter: TaskFilter }) {
  const [open, setOpen] = useState(true);
  const visibleTasks = client.tasks.filter((t) => {
    if (taskFilter === "open") return t.status !== "complete";
    if (taskFilter === "overdue") return t.overdue;
    if (taskFilter === "done") return t.status === "complete";
    return true;
  });
  if (taskFilter !== "all" && visibleTasks.length === 0) return null;
  const openTasks = visibleTasks.filter((t) => t.status !== "complete");
  const doneTasks = visibleTasks.filter((t) => t.status === "complete");

  return (
    <div style={{ marginBottom: 10, border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#f8fafc", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{client.clientName}</span>
        <span style={{ fontSize: 11, color: "#64748b", background: "#e2e8f0", borderRadius: 20, padding: "2px 8px" }}>
          {client.totalTasks} task{client.totalTasks !== 1 ? "s" : ""}
        </span>
        {client.overdueTasks > 0 && (
          <span style={{ fontSize: 11, color: "#b91c1c", background: "#fee2e2", borderRadius: 20, padding: "2px 8px", fontWeight: 700 }}>
            {client.overdueTasks} overdue
          </span>
        )}
        <span style={{ fontSize: 11, color: "#15803d", background: "#dcfce7", borderRadius: 20, padding: "2px 8px" }}>
          {client.doneTasks} done
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && visibleTasks.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Task</th>
                <th style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "#64748b", textAlign: "left", whiteSpace: "nowrap" }}>Status</th>
                <th style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Column</th>
                <th style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Owner</th>
                <th style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "#64748b", textAlign: "left" }}>Due</th>
              </tr>
            </thead>
            <tbody>
              {openTasks.map((t) => <TaskRow key={t.id} task={t} />)}
              {doneTasks.length > 0 && openTasks.length > 0 && (
                <tr><td colSpan={5} style={{ padding: "4px 10px", fontSize: 11, color: "#94a3b8", background: "#f8fafc", fontStyle: "italic" }}>Completed</td></tr>
              )}
              {doneTasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </tbody>
          </table>
        </div>
      )}
      {open && visibleTasks.length === 0 && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "#94a3b8" }}>No tasks matching this filter.</div>
      )}
    </div>
  );
}

const ROLE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  am:         { bg: "#dbeafe", color: "#1d4ed8" },
  team_lead:  { bg: "#ede9fe", color: "#6d28d9" },
  senior:     { bg: "#fef3c7", color: "#92400e" },
  junior:     { bg: "#dcfce7", color: "#15803d" },
  associate:  { bg: "#f1f5f9", color: "#475569" },
  intern:     { bg: "#f1f5f9", color: "#475569" },
  ops_head:   { bg: "#fee2e2", color: "#b91c1c" },
  admin:      { bg: "#fce7f3", color: "#be185d" },
};

function RoleBadge({ role }: { role: string }) {
  const c = ROLE_BADGE_COLORS[role] ?? { bg: "#f1f5f9", color: "#475569" };
  const label = role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 4, background: c.bg, color: c.color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function PersonHeader({
  node, accent, level,
}: {
  node: PersonNode;
  accent: string;
  level: "am" | "team_lead" | "team_member";
}) {
  const fontSize = level === "am" ? 15 : level === "team_lead" ? 14 : 13;
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize, fontWeight: 700, color: "#0f172a" }}>{node.name}</span>
        <RoleBadge role={node.role} />
        {node.title && <span style={{ fontSize: 11, color: "#64748b" }}>· {node.title}</span>}
      </div>
      {node.email && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{node.email}</div>}
      <div style={{ display: "none" }}>{accent}</div>
    </div>
  );
}

function PersonStatChips({ node }: { node: PersonNode }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {node.totalActions > 0 && (
        <span style={{ fontSize: 11.5, background: "#fef3c7", color: "#92400e", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap", fontWeight: 700 }}>
          {node.totalActions} action item{node.totalActions !== 1 ? "s" : ""}
        </span>
      )}
      <span style={{ fontSize: 11.5, background: "#e0f2fe", color: "#0369a1", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>
        {node.totalClients} client{node.totalClients !== 1 ? "s" : ""}
      </span>
      <span style={{ fontSize: 11.5, background: "#f1f5f9", color: "#475569", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>
        {node.totalOpen} open
      </span>
      {node.totalOverdue > 0 && (
        <span style={{ fontSize: 11.5, background: "#fee2e2", color: "#b91c1c", borderRadius: 20, padding: "2px 9px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {node.totalOverdue} overdue
        </span>
      )}
      <span style={{ fontSize: 11.5, background: "#dcfce7", color: "#15803d", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>
        {node.totalDone} done
      </span>
    </div>
  );
}

function PersonBody({
  node, taskFilter, search,
}: { node: PersonNode; taskFilter: TaskFilter; search: string }) {
  const visibleClients = (search
    ? node.clients.filter((c) => c.clientName.toLowerCase().includes(search.toLowerCase()))
    : node.clients
  ).filter((c) => {
    if (taskFilter === "open") return c.openTasks > 0;
    if (taskFilter === "overdue") return c.overdueTasks > 0;
    if (taskFilter === "done") return c.doneTasks > 0;
    return true;
  });

  return (
    <div>
      <ActionItemsPanel items={node.actionItems} />
      <div>
        {visibleClients.length === 0 ? (
          <div style={{ padding: "10px 0", fontSize: 12.5, color: "#94a3b8" }}>No clients match this filter.</div>
        ) : (
          visibleClients.map((c) => <ClientSection key={c.runId} client={c} taskFilter={taskFilter} />)
        )}
      </div>
    </div>
  );
}

function TeamMemberSection({ node, taskFilter, search, defaultOpen = false }: { node: PersonNode; taskFilter: TaskFilter; search: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const headlineBg = node.totalOverdue > 0 ? "#fef2f2" : "#fafaf9";
  return (
    <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", background: headlineBg, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <PersonHeader node={node} accent="#475569" level="team_member" />
        <PersonStatChips node={node} />
        <span style={{ fontSize: 11, color: "#64748b" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "12px 14px", background: "#fff" }}>
          <PersonBody node={node} taskFilter={taskFilter} search={search} />
        </div>
      )}
    </div>
  );
}

function TeamLeadSection({ node, taskFilter, search, defaultOpen = false }: { node: TeamLeadNode; taskFilter: TaskFilter; search: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 10, border: "1px solid #c4b5fd", borderRadius: 10, overflow: "hidden", background: "#faf5ff" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "#f5f3ff", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <PersonHeader node={node} accent="#7c3aed" level="team_lead" />
        <PersonStatChips node={node} />
        {node.teamMembers.length > 0 && (
          <span style={{ fontSize: 11.5, background: "#ede9fe", color: "#6d28d9", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap", fontWeight: 600 }}>
            {node.teamMembers.length} team
          </span>
        )}
        <span style={{ fontSize: 11, color: "#7c3aed" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "14px 16px", background: "#fff" }}>
          <PersonBody node={node} taskFilter={taskFilter} search={search} />
          {node.teamMembers.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8", marginBottom: 4 }}>
                Team members
              </div>
              {node.teamMembers.map((tm) => <TeamMemberSection key={tm.personId} node={tm} taskFilter={taskFilter} search={search} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AmSection({ am, taskFilter, search }: { am: AmReportEntry; taskFilter: TaskFilter; search: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 20, border: "1px solid #cbd5e1", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "#f0f9ff", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <PersonHeader node={am} accent="#0369a1" level="am" />
        <PersonStatChips node={am} />
        {am.teamLeads.length > 0 && (
          <span style={{ fontSize: 11.5, background: "#e0e7ff", color: "#3730a3", borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap", fontWeight: 600 }}>
            {am.teamLeads.length} team lead{am.teamLeads.length !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ fontSize: 11, color: "#64748b" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "14px 18px" }}>
          <PersonBody node={am} taskFilter={taskFilter} search={search} />
          {am.teamLeads.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8", marginBottom: 4 }}>
                Team leads
              </div>
              {am.teamLeads.map((tl) => <TeamLeadSection key={tl.personId} node={tl} taskFilter={taskFilter} search={search} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AmReportView({
  ams,
  generatedAt,
  viewerRole,
  viewerName,
  loadError,
}: {
  ams: AmReportEntry[];
  generatedAt: string;
  viewerRole: Role | "";
  viewerName: string | null;
  loadError: string | null;
}) {
  const [selectedPerson, setSelectedPerson] = useState<string>("all");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [search, setSearch] = useState("");

  // Flat list of everyone in scope, grouped by role for the dropdown.
  const peopleOptions: { id: string; label: string; group: string; node: PersonNode | AmReportEntry | TeamLeadNode; kind: "am" | "team_lead" | "team_member" }[] = [];
  for (const am of ams) {
    peopleOptions.push({
      id: am.personId,
      label: `${am.name} — ${am.totalClients} client${am.totalClients !== 1 ? "s" : ""}, ${am.totalOpen} open${am.totalOverdue > 0 ? `, ${am.totalOverdue} overdue` : ""}${am.totalActions > 0 ? `, ${am.totalActions} actions` : ""}`,
      group: "Account Managers",
      node: am,
      kind: "am",
    });
    for (const tl of am.teamLeads) {
      peopleOptions.push({
        id: tl.personId,
        label: `${tl.name} (TL · under ${am.name})${tl.totalActions > 0 ? ` — ${tl.totalActions} actions` : ""}${tl.totalOverdue > 0 ? `, ${tl.totalOverdue} overdue` : ""}`,
        group: "Team Leads",
        node: tl,
        kind: "team_lead",
      });
      for (const tm of tl.teamMembers) {
        peopleOptions.push({
          id: tm.personId,
          label: `${tm.name} (${tm.role.replace(/_/g, " ")} · under ${tl.name})${tm.totalActions > 0 ? ` — ${tm.totalActions} actions` : ""}${tm.totalOverdue > 0 ? `, ${tm.totalOverdue} overdue` : ""}`,
          group: "Team Members",
          node: tm,
          kind: "team_member",
        });
      }
    }
  }

  const selectedOption = peopleOptions.find((p) => p.id === selectedPerson) ?? null;

  // When an AM is selected we use the existing AmSection.
  // For TL / TM we render a single focused section below.
  const afterAmFilter: AmReportEntry[] =
    selectedPerson === "all"
      ? ams
      : selectedOption?.kind === "am"
        ? ams.filter((a) => a.amId === selectedPerson)
        : [];

  function exportCsv() {
    const rows: string[][] = [
      ["Section Role", "Person", "Email", "Client", "Task", "Status", "Column", "Owner", "Due Date", "Overdue"],
    ];
    const flatten = (node: PersonNode, sectionRole: string) => {
      for (const client of node.clients) {
        const tasks = client.tasks.filter((t) => {
          if (taskFilter === "open") return t.status !== "complete";
          if (taskFilter === "overdue") return t.overdue;
          if (taskFilter === "done") return t.status === "complete";
          return true;
        });
        if (tasks.length === 0) {
          rows.push([sectionRole, node.name, node.email ?? "", client.clientName, "(no tasks)", "", "", "", "", ""]);
        } else {
          for (const t of tasks) {
            rows.push([
              sectionRole,
              node.name,
              node.email ?? "",
              client.clientName,
              t.title,
              t.status,
              t.boardColumn ?? "",
              t.ownerName ?? (t.ownerKind === "client" ? "Client" : ""),
              t.dueDate ?? "",
              t.overdue ? "Yes" : "No",
            ]);
          }
        }
      }
    };
    for (const am of afterAmFilter) {
      flatten(am, "AM");
      for (const tl of am.teamLeads) {
        flatten(tl, "Team Lead");
        for (const tm of tl.teamMembers) flatten(tm, "Team Member");
      }
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `weekly-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Top-of-page totals
  const totalAms = afterAmFilter.length;
  const totalClients = afterAmFilter.reduce((s, a) => s + a.clients.length, 0);
  const totalOpen = afterAmFilter.reduce((s, a) => s + a.totalOpen, 0);
  const totalOverdue = afterAmFilter.reduce((s, a) => s + a.totalOverdue, 0);
  const totalDone = afterAmFilter.reduce((s, a) => s + a.totalDone, 0);
  const totalActions = afterAmFilter.reduce((s, a) => {
    const tlActions = a.teamLeads.reduce((ss, tl) => {
      const tmActions = tl.teamMembers.reduce((sss, tm) => sss + tm.totalActions, 0);
      return ss + tl.totalActions + tmActions;
    }, 0);
    return s + a.totalActions + tlActions;
  }, 0);

  const headingText =
    viewerRole === "admin" || viewerRole === "ops_head" ? "Weekly Report — All AMs"
    : viewerRole === "am" ? `Weekly Report — ${viewerName ?? "You"}`
    : viewerRole === "team_lead" ? `Weekly Report — ${viewerName ?? "You"}`
    : "Weekly Report";

  const selectStyle: React.CSSProperties = {
    padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
    fontSize: 13, background: "#fff", cursor: "pointer", outline: "none",
  };
  const filterBtnStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: 20, border: `1.5px solid ${active ? color : "#e2e8f0"}`,
    background: active ? color : "#fff", color: active ? "#fff" : "#475569",
    fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
  });

  return (
    <div className="scroll" style={{ height: "100%", overflowY: "auto" }}>
      <div className="page" style={{ maxWidth: 1280, paddingBottom: 60 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>{headingText}</h1>
              <button
                onClick={exportCsv}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0369a1", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                title="Export current view as CSV"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3, #64748b)", marginTop: 3 }}>
              Task boards + open action items, grouped by AM. Expand a row to drill into Team Leads, then their Team Members.
              {generatedAt && <> · as of {new Date(generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { value: totalAms, label: "AMs", bg: "#f0f9ff", border: "#bae6fd", color: "#0369a1" },
              { value: totalActions, label: "Action Items", bg: "#fffbeb", border: "#fde68a", color: "#92400e" },
              { value: totalClients, label: "Clients", bg: "#f8fafc", border: "#e2e8f0", color: "#0f172a" },
              { value: totalOpen, label: "Open Tasks", bg: "#fef9c3", border: "#fde68a", color: "#92400e" },
              { value: totalOverdue, label: "Overdue", bg: "#fee2e2", border: "#fca5a5", color: "#b91c1c" },
              { value: totalDone, label: "Done", bg: "#dcfce7", border: "#86efac", color: "#15803d" },
            ].map(({ value, label, bg, border, color }) => (
              <div key={label} style={{ padding: "6px 14px", borderRadius: 10, background: bg, border: `1px solid ${border}`, textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {loadError && (
          <div style={{ padding: 12, borderRadius: 8, background: "#fee2e2", color: "#b91c1c", marginBottom: 14, fontSize: 13 }}>{loadError}</div>
        )}

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center", padding: "12px 14px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Drill into person</label>
            <select value={selectedPerson} onChange={(e) => setSelectedPerson(e.target.value)} style={{ ...selectStyle, minWidth: 280 }}>
              <option value="all">All ({peopleOptions.length} people)</option>
              <optgroup label="Account Managers">
                {peopleOptions.filter((p) => p.kind === "am").map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
              {peopleOptions.some((p) => p.kind === "team_lead") && (
                <optgroup label="Team Leads">
                  {peopleOptions.filter((p) => p.kind === "team_lead").map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
              )}
              {peopleOptions.some((p) => p.kind === "team_member") && (
                <optgroup label="Team Members">
                  {peopleOptions.filter((p) => p.kind === "team_member").map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Search client</label>
            <input
              type="text"
              placeholder="Client name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...selectStyle, minWidth: 200 }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Show tasks</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", "open", "overdue", "done"] as const).map((f) => {
                const colors: Record<string, string> = { all: "#64748b", open: "#f59e0b", overdue: "#ef4444", done: "#22c55e" };
                return (
                  <button key={f} style={filterBtnStyle(taskFilter === f, colors[f])} onClick={() => setTaskFilter(f)}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {(selectedPerson !== "all" || search || taskFilter !== "all") && (
            <button
              style={{ marginTop: 18, padding: "5px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, cursor: "pointer" }}
              onClick={() => { setSelectedPerson("all"); setSearch(""); setTaskFilter("all"); }}
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Focused drill: a TL or TM was picked — render just their section */}
        {selectedOption && selectedOption.kind === "team_lead" && (
          <TeamLeadSection node={selectedOption.node as TeamLeadNode} taskFilter={taskFilter} search={search} defaultOpen={true} />
        )}
        {selectedOption && selectedOption.kind === "team_member" && (
          <TeamMemberSection node={selectedOption.node as PersonNode} taskFilter={taskFilter} search={search} defaultOpen={true} />
        )}

        {/* AM sections (all-mode and AM-selected) */}
        {(selectedPerson === "all" || (selectedOption?.kind === "am")) && (
          afterAmFilter.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              No results match your filters.
            </div>
          ) : (
            afterAmFilter.map((am) => <AmSection key={am.amId} am={am} taskFilter={taskFilter} search={search} />)
          )
        )}
      </div>
    </div>
  );
}
