"use client";

import { useState } from "react";
import type { AmReportEntry, AmReportClient, AmReportTask } from "./actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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

function ClientSection({ client, taskFilter }: { client: AmReportClient; taskFilter: "all" | "open" | "overdue" | "done" }) {
  const [open, setOpen] = useState(true);

  const visibleTasks = client.tasks.filter((t) => {
    if (taskFilter === "open") return t.status !== "complete";
    if (taskFilter === "overdue") return t.overdue;
    if (taskFilter === "done") return t.status === "complete";
    return true;
  });

  const openTasks = visibleTasks.filter((t) => t.status !== "complete");
  const doneTasks = visibleTasks.filter((t) => t.status === "complete");

  if (taskFilter !== "all" && visibleTasks.length === 0) return null;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "#f8fafc", cursor: "pointer", userSelect: "none" }}
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

function AmSection({ am, taskFilter }: { am: AmReportEntry; taskFilter: "all" | "open" | "overdue" | "done" }) {
  const [open, setOpen] = useState(true);

  // Filter out clients that have no visible tasks when a filter is active
  const visibleClients = taskFilter === "all"
    ? am.clients
    : am.clients.filter((c) => {
        if (taskFilter === "open") return c.openTasks > 0;
        if (taskFilter === "overdue") return c.overdueTasks > 0;
        if (taskFilter === "done") return c.doneTasks > 0;
        return true;
      });

  return (
    <div style={{ marginBottom: 20, border: "1px solid #cbd5e1", borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "#f0f9ff", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{am.amName}</div>
          {am.amEmail && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 1 }}>{am.amEmail}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, background: "#e0f2fe", color: "#0369a1", borderRadius: 20, padding: "2px 10px", whiteSpace: "nowrap" }}>
            {am.totalClients} client{am.totalClients !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: 12, background: "#f1f5f9", color: "#475569", borderRadius: 20, padding: "2px 10px", whiteSpace: "nowrap" }}>
            {am.totalOpen} open
          </span>
          {am.totalOverdue > 0 && (
            <span style={{ fontSize: 12, background: "#fee2e2", color: "#b91c1c", borderRadius: 20, padding: "2px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>
              {am.totalOverdue} overdue
            </span>
          )}
          <span style={{ fontSize: 12, background: "#dcfce7", color: "#15803d", borderRadius: 20, padding: "2px 10px", whiteSpace: "nowrap" }}>
            {am.totalDone} done
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "14px 18px" }}>
          {visibleClients.length === 0 ? (
            <div style={{ padding: "10px 0", fontSize: 13, color: "#94a3b8" }}>No clients match this filter.</div>
          ) : (
            visibleClients.map((c) => <ClientSection key={c.runId} client={c} taskFilter={taskFilter} />)
          )}
        </div>
      )}
    </div>
  );
}

export function AmReportView({
  ams,
  generatedAt,
  loadError,
}: {
  ams: AmReportEntry[];
  generatedAt: string;
  loadError: string | null;
}) {
  const [selectedAm, setSelectedAm] = useState<string>("all");
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "overdue" | "done">("all");
  const [search, setSearch] = useState("");

  // Step 1: filter by selected AM
  const afterAmFilter = selectedAm === "all" ? ams : ams.filter((a) => a.amId === selectedAm);

  // Step 2: filter by search (client name or AM name)
  const afterSearch = search.trim()
    ? afterAmFilter.map((am) => ({
        ...am,
        clients: am.clients.filter((c) =>
          c.clientName.toLowerCase().includes(search.toLowerCase()) ||
          am.amName.toLowerCase().includes(search.toLowerCase()),
        ),
      })).filter((am) => am.clients.length > 0)
    : afterAmFilter;

  function exportCsv() {
    const rows: string[][] = [
      ["AM Name", "AM Email", "Client", "Task", "Status", "Column", "Owner", "Due Date", "Overdue"],
    ];
    for (const am of afterSearch) {
      for (const client of am.clients) {
        const tasks = client.tasks.filter((t) => {
          if (taskFilter === "open") return t.status !== "complete";
          if (taskFilter === "overdue") return t.overdue;
          if (taskFilter === "done") return t.status === "complete";
          return true;
        });
        if (tasks.length === 0) {
          rows.push([am.amName, am.amEmail ?? "", client.clientName, "(no tasks)", "", "", "", "", ""]);
        } else {
          for (const t of tasks) {
            rows.push([
              am.amName,
              am.amEmail ?? "",
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
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `am-weekly-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Summary stats (from afterSearch, not filtered by taskFilter — show real totals)
  const totalAms = afterSearch.length;
  const totalClients = afterSearch.reduce((s, a) => s + a.clients.length, 0);
  const totalOpen = afterSearch.reduce((s, a) => s + a.totalOpen, 0);
  const totalOverdue = afterSearch.reduce((s, a) => s + a.totalOverdue, 0);
  const totalDone = afterSearch.reduce((s, a) => s + a.totalDone, 0);

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
      <div className="page" style={{ maxWidth: 1200, paddingBottom: 60 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>AM Weekly Report</h1>
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
              All active client task boards grouped by Account Manager
              {generatedAt && <> · as of {new Date(generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
            </div>
          </div>
          {/* Summary chips */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { value: totalAms, label: "AMs", bg: "#f0f9ff", border: "#bae6fd", color: "#0369a1" },
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
          {/* AM selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Account Manager</label>
            <select value={selectedAm} onChange={(e) => setSelectedAm(e.target.value)} style={selectStyle}>
              <option value="all">All AMs ({ams.length})</option>
              {ams.map((a) => (
                <option key={a.amId} value={a.amId}>
                  {a.amName} — {a.totalClients} client{a.totalClients !== 1 ? "s" : ""}, {a.totalOpen} open{a.totalOverdue > 0 ? `, ${a.totalOverdue} overdue` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Client search */}
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

          {/* Task status filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Show tasks</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", "open", "overdue", "done"] as const).map((f) => {
                const colors: Record<string, string> = { all: "#64748b", open: "#f59e0b", overdue: "#ef4444", done: "#22c55e" };
                return (
                  <button
                    key={f}
                    style={filterBtnStyle(taskFilter === f, colors[f])}
                    onClick={() => setTaskFilter(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset */}
          {(selectedAm !== "all" || search || taskFilter !== "all") && (
            <button
              style={{ marginTop: 18, padding: "5px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, cursor: "pointer" }}
              onClick={() => { setSelectedAm("all"); setSearch(""); setTaskFilter("all"); }}
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Results */}
        {afterSearch.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
            No results match your filters.
          </div>
        ) : (
          afterSearch.map((am) => <AmSection key={am.amId} am={am} taskFilter={taskFilter} />)
        )}
      </div>
    </div>
  );
}
