"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import {
  createClientAction,
  markSignedAction,
  setClientStatusAction,
  deleteClientAction,
  deleteRunAction,
  bulkSetClientStatus,
  bulkDeleteClients,
  prepareStandaloneIntake,
  sendStandaloneIntakeEmail,
  copyClientAction,
  setClientAm,
  updateClientBeforeSign,
  deleteClientGroup,
  assignAmlRun,
  assignToAmlAction,
  type NewClientInput,
  type StandaloneIntakePrep,
} from "./actions";

export interface ClientRow {
  id: string;
  name: string;
  owner_name: string | null;
  industry: string | null;
  entity_type: string | null;
  status: "lead" | "signed" | "onboarding" | "active" | "inactive" | "hold" | "paused";
  services: string[] | null;
  primary_contact_email: string | null;
  phone: string | null;
  profile_complete: boolean;
  am_id: string | null;
  custom_code: string | null;
  trade_licence_no: string | null;
  trade_licence_authority: string | null;
  contract_start_date: string | null;
  target_go_live: string | null;
  expected_onboarding_days: number | null;
  proposal_id: string | null;
  group_id: string | null;
  report_frequency: string | null;
}
export interface ClientGroup { id: string; name: string }
export interface RunLite {
  id: string;
  client_id: string;
  progress: number;
  current_stage: number;
  status: string;
}
export interface AmOption {
  id: string;
  full_name: string;
  role: string;
  title: string | null;
}
export type ClientTeamMap = Record<string, { seniors: string[]; teamLeads: string[]; juniors: string[] }>;

const STATUS_PILL: Record<ClientRow["status"], string> = {
  onboarding: "amber",
  active: "green",
  lead: "blue",
  signed: "purple",
  inactive: "gray",
  hold: "amber",
  paused: "gray",
};
const STATUS_LABEL: Record<ClientRow["status"], string> = {
  onboarding: "Onboarding",
  active: "Active",
  lead: "Lead",
  signed: "Signed",
  inactive: "Inactive",
  hold: "On hold",
  paused: "Paused",
};
const TABS = ["All", "Active", "Onboarding", "Lead", "Hold", "Paused", "Inactive", "Overdue Payments", "AML Pending"] as const;

// Generalised UAE industry buckets — broad enough that any incoming business fits one.
// The COA engine classifies by the client's primary activity, so these are deliberately wide.
export const INDUSTRIES = [
  "Retail & General Trading",
  "Wholesale & Distribution",
  "E-commerce",
  "Food & Beverage / Restaurants",
  "Hospitality, Travel & Tourism",
  "Real Estate & Property Management",
  "Construction & Contracting",
  "Logistics, Transport & Supply Chain",
  "Manufacturing & Industrial",
  "Professional Services (Consulting, Legal, Marketing)",
  "Healthcare & Medical",
  "Education & Training",
  "Technology / SaaS / IT Services",
  "Financial Services & Fintech",
  "Media, Advertising & Creative",
  "Oil, Gas & Energy",
  "Automotive & Vehicle Services",
  "Beauty, Wellness & Salons",
  "Events & Entertainment",
  "Agriculture & Foodstuff",
  "Telecommunications",
  "Holding / Investment Company",
  "Non-Profit / Association",
  "Other",
];
export const ENTITIES: [string, string][] = [["mainland", "Mainland"], ["free_zone", "Free Zone"], ["offshore", "Offshore"]];

export const UAE_AUTHORITIES = [
  "DED Dubai", "ADDED Abu Dhabi", "SEDD Sharjah", "Ajman DED", "RAK DED", "UAQ DED", "Fujairah DED",
  "DMCC", "IFZA", "DIFC", "ADGM", "JAFZA", "Dubai South", "RAKEZ", "SHAMS", "Dubai Digital Park",
  "Dubai Airport Free Zone", "Creative City Fujairah", "KIZAD", "twofour54", "Dubai Internet City",
  "Dubai Media City", "Dubai Science Park", "Dubai Healthcare City", "Meydan Free Zone",
  "Dubai Multi Commodities Centre", "Abu Dhabi Global Market", "Other",
];
const SERVICES = ["Bookkeeping", "VAT", "Corporate Tax", "CFO Reports", "Catch-up Accounting", "Payroll"];

const SIGN_STEPS = [
  "Creating onboarding run…",
  "Notifying Ops Manager…",
  "Setting up Drive folder…",
  "Onboarding started",
];

export interface TemplateOpt { id: string; name: string; desc?: string; stages: number }

export interface IntakeStatus { sent: boolean; submitted: boolean; submittedAt: string | null }

export function ClientsTable({
  clients,
  groups = [],
  runByClient,
  teamByClient = {},
  members,
  templates,
  canDelete,
  canManageStatus,
  masterAdmin = false,
  intakeByClient = {},
  overdueClientIds = new Set<string>(),
  amlAssignedClientIds = new Set<string>(),
}: {
  clients: ClientRow[];
  groups?: ClientGroup[];
  runByClient: Record<string, RunLite>;
  teamByClient?: ClientTeamMap;
  members: AmOption[];
  templates: TemplateOpt[];
  canDelete: boolean;
  canManageStatus: boolean;
  masterAdmin?: boolean;
  intakeByClient?: Record<string, IntakeStatus>;
  overdueClientIds?: Set<string>;
  amlAssignedClientIds?: Set<string>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [search, setSearch] = useState("");
  const [fIndustry, setFIndustry] = useState("all");
  const [fEntity, setFEntity] = useState("all");
  const [fMonth, setFMonth] = useState("all");
  const [fAuthority, setFAuthority] = useState("all");
  const [fTeamLead, setFTeamLead] = useState("all");
  const [fFrequency, setFFrequency] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [picking, setPicking] = useState<{ clientId: string; name: string; amId: string; patch?: { ownerName?: string | null; industry?: string | null; entityType?: string | null; services?: string[]; email?: string | null; phone?: string | null; proposalId?: string | null; tradeAuthority?: string | null; tradeLicenceNo?: string | null; contractStart?: string | null; targetGoLive?: string | null; expectedDays?: number | null } } | null>(null);
  const [signing, setSigning] = useState<{ name: string; step: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ kind: "client" | "run"; id: string; name: string } | null>(null);
  const [confirmDelGroup, setConfirmDelGroup] = useState<{ id: string; name: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [intakeFor, setIntakeFor] = useState<{ clientId: string; name: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [changeAmFor, setChangeAmFor] = useState<{ clientId: string; name: string; currentAmId: string | null } | null>(null);
  const [pickingAm, setPickingAm] = useState<{
    clientId: string; name: string;
    ownerName: string | null; industry: string | null; entityType: string | null;
    services: string[] | null; amId: string | null;
    email: string | null; phone: string | null;
    proposalId: string | null; tradeAuthority: string | null; tradeLicenceNo: string | null;
    contractStart: string | null; targetGoLive: string | null; expectedDays: number | null;
  } | null>(null);

  // Configurable columns — user picks which optional columns to show; persisted
  // in localStorage per browser. Client / Status / Actions are always visible.
  const ALL_COLS: Array<{ id: string; label: string; admin?: boolean }> = [
    { id: "code", label: "Code", admin: true },
    { id: "industry", label: "Industry" },
    { id: "frequency", label: "Report frequency" },
    { id: "team", label: "Team Lead / Senior", admin: true },
    { id: "services", label: "Services" },
    { id: "progress", label: "Progress" },
  ];
  const DEFAULT_VISIBLE = new Set(["code", "industry", "frequency", "team", "services", "progress"]);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE);
  const [colsOpen, setColsOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("cadence-clients-cols") : null;
      if (raw) setVisibleCols(new Set(JSON.parse(raw) as string[]));
    } catch { /* localStorage may be unavailable */ }
  }, []);
  const toggleCol = (id: string) => {
    setVisibleCols((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { window.localStorage.setItem("cadence-clients-cols", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const show = (id: string) => visibleCols.has(id);

  const showToast = (msg: string, kind = "green") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());

  const toggleGroup = (groupId: string) => setExpandedGroups((s) => { const n = new Set(s); n.has(groupId) ? n.delete(groupId) : n.add(groupId); return n; });

  const doCopyClient = async (clientId: string, name: string) => {
    setMenuFor(null);
    const res = await copyClientAction(clientId);
    if (res.error) showToast(res.error, "red");
    else { showToast(`${name} duplicated as a lead`); router.refresh(); }
  };

  const doChangeAm = async (clientId: string, newAmId: string, name: string) => {
    const res = await setClientAm(clientId, newAmId);
    if (res.error) showToast(res.error, "red");
    else { showToast(`AM updated for ${name}`); setChangeAmFor(null); router.refresh(); }
  };

  // Build a grouped view: group header rows + standalone rows
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g]));

  // Grouped clients: group_id present
  const groupedClients = useMemo(() => {
    const byGroup: Record<string, ClientRow[]> = {};
    for (const c of clients) {
      if (c.group_id) (byGroup[c.group_id] ??= []).push(c);
    }
    return byGroup;
  }, [clients]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesTab = (c: ClientRow) =>
      tab === "All" ? true
      : tab === "Overdue Payments" ? overdueClientIds.has(c.id)
      : tab === "AML Pending" ? (["active", "onboarding", "hold", "paused"].includes(c.status ?? "") && !amlAssignedClientIds.has(c.id))
      : c.status === tab.toLowerCase();
    const matchesSearch = (c: ClientRow) =>
      !q || c.name.toLowerCase().includes(q) || (c.owner_name ?? "").toLowerCase().includes(q) || (c.industry ?? "").toLowerCase().includes(q);
    const matchesFilters = (c: ClientRow) => {
      if (fIndustry !== "all" && c.industry !== fIndustry) return false;
      if (fEntity !== "all" && c.entity_type !== fEntity) return false;
      if (fMonth !== "all" && (c.contract_start_date ?? "").slice(0, 7) !== fMonth) return false;
      if (fAuthority !== "all" && c.trade_licence_authority !== fAuthority) return false;
      if (fTeamLead !== "all" && !(teamByClient[c.id]?.teamLeads ?? []).includes(fTeamLead)) return false;
      if (fFrequency !== "all" && (c.report_frequency ?? "monthly") !== fFrequency) return false;
      return true;
    };

    type RowItem =
      | { kind: "standalone"; client: ClientRow }
      | { kind: "group-header"; groupId: string; groupName: string; children: ClientRow[] }
      | { kind: "group-child"; client: ClientRow; groupId: string };

    const rows: RowItem[] = [];
    const seenGroups = new Set<string>();

    for (const c of clients) {
      if (c.group_id) {
        if (!seenGroups.has(c.group_id)) {
          seenGroups.add(c.group_id);
          const allGroupChildren = groupedClients[c.group_id] ?? [];
          const children = allGroupChildren.filter((ch) => matchesTab(ch) && matchesSearch(ch) && matchesFilters(ch));
          const hasFilter = tab !== "All" || q || fIndustry !== "all" || fEntity !== "all" || fMonth !== "all" || fAuthority !== "all" || fTeamLead !== "all" || fFrequency !== "all";
          if (children.length === 0 && hasFilter) continue;
          rows.push({ kind: "group-header", groupId: c.group_id, groupName: groupMap[c.group_id]?.name ?? "Group", children: allGroupChildren });
        }
      } else {
        if (matchesTab(c) && matchesSearch(c) && matchesFilters(c)) rows.push({ kind: "standalone", client: c });
      }
    }

    // Expand group children
    const result: RowItem[] = [];
    for (const row of rows) {
      result.push(row);
      if (row.kind === "group-header" && expandedGroups.has(row.groupId)) {
        // Reuse the exact same predicates as top-level rows (matchesTab / matchesSearch /
        // matchesFilters) — a previous inline re-implementation here only checked a bare
        // status match, so the "Overdue Payments" / "AML Pending" quick tabs and the
        // industry/entity/authority/team-lead/frequency filters silently did nothing to
        // clients nested inside an expanded group.
        const visibleChildren = row.children.filter((ch) => matchesTab(ch) && matchesSearch(ch) && matchesFilters(ch));
        for (const ch of visibleChildren) result.push({ kind: "group-child", client: ch, groupId: row.groupId });
      }
    }

    return result;
  }, [clients, tab, search, fIndustry, fEntity, fMonth, fAuthority, fTeamLead, fFrequency, teamByClient, overdueClientIds, amlAssignedClientIds, groupedClients, groupMap, expandedGroups]);

  // Filter-dropdown option lists — derived from the live client list so a filter
  // never offers a value that would match zero rows.
  const industryOpts = useMemo(() => [...new Set(clients.map((c) => c.industry).filter(Boolean) as string[])].sort(), [clients]);
  const monthOpts = useMemo(() => [...new Set(clients.map((c) => c.contract_start_date?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(), [clients]);
  const authorityOpts = useMemo(() => [...new Set(clients.map((c) => c.trade_licence_authority).filter(Boolean) as string[])].sort(), [clients]);
  const teamLeadOpts = useMemo(() => [...new Set(Object.values(teamByClient).flatMap((t) => t.teamLeads))].sort(), [teamByClient]);
  const hasFilters = fIndustry !== "all" || fEntity !== "all" || fMonth !== "all" || fAuthority !== "all" || fTeamLead !== "all" || fFrequency !== "all";
  const clearFilters = () => { setFIndustry("all"); setFEntity("all"); setFMonth("all"); setFAuthority("all"); setFTeamLead("all"); setFFrequency("all"); };

  // Live counts per status pill / quick-filter tab — always computed off the full
  // client list so switching tabs doesn't change the numbers on the other pills.
  const tabCounts = useMemo(() => {
    const counts = {} as Record<(typeof TABS)[number], number>;
    for (const t of TABS) {
      if (t === "All") counts[t] = clients.length;
      else if (t === "Overdue Payments") counts[t] = clients.filter((c) => overdueClientIds.has(c.id)).length;
      else if (t === "AML Pending") counts[t] = clients.filter((c) => ["active", "onboarding", "hold", "paused"].includes(c.status ?? "") && !amlAssignedClientIds.has(c.id)).length;
      else counts[t] = clients.filter((c) => c.status === t.toLowerCase()).length;
    }
    return counts;
  }, [clients, overdueClientIds, amlAssignedClientIds]);
  const STATUS_TABS = TABS.slice(0, 7);
  const QUICK_TABS = TABS.slice(7);

  const bulkStatus = async (status: "lead" | "active" | "hold" | "paused", label: string) => {
    const ids = [...selected];
    const res = await bulkSetClientStatus(ids, status);
    if (res.error) showToast(res.error, "red");
    else { showToast(`${res.count ?? ids.length} ${label}`); clearSel(); router.refresh(); }
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    setBusy(true);
    const res = await bulkDeleteClients(ids);
    setBusy(false);
    setBulkConfirm(false);
    if (res.error) showToast(res.error, "red");
    else { showToast(`${res.count ?? ids.length} clients deleted`); clearSel(); router.refresh(); }
  };

  const changeStatus = async (clientId: string, status: "active" | "hold" | "paused" | "lead", label: string) => {
    setMenuFor(null);
    const res = await setClientStatusAction(clientId, status);
    if (res.error) showToast(res.error, "red");
    else {
      showToast(label);
      router.refresh();
    }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setBusy(true);
    const res =
      confirmDel.kind === "client"
        ? await deleteClientAction(confirmDel.id)
        : await deleteRunAction(confirmDel.id);
    setBusy(false);
    setConfirmDel(null);
    if (res.error) showToast(res.error, "red");
    else {
      showToast(confirmDel.kind === "client" ? "Client deleted" : "Onboarding run deleted");
      router.refresh();
    }
  };

  // filteredRows replaces the old `filtered` flat list — see grouped useMemo above

  const runMarkSigned = async (clientId: string, name: string, templateId: string, amId?: string, patch?: { ownerName?: string | null; industry?: string | null; entityType?: string | null; services?: string[]; email?: string | null; phone?: string | null; proposalId?: string | null; tradeAuthority?: string | null; tradeLicenceNo?: string | null; contractStart?: string | null; targetGoLive?: string | null; expectedDays?: number | null }) => {
    setPicking(null);
    setSigning({ name, step: 0 });
    const timer = setInterval(
      () => setSigning((s) => (s ? { ...s, step: Math.min(s.step + 1, SIGN_STEPS.length - 2) } : s)),
      800,
    );
    if (patch) {
      await updateClientBeforeSign(clientId, {
        owner_name: patch.ownerName ?? null,
        industry: patch.industry ?? null,
        entity_type: patch.entityType ?? null,
        services: patch.services,
        am_id: amId ?? null,
        primary_contact_email: patch.email ?? null,
        phone: patch.phone ?? null,
        proposal_id: patch.proposalId ?? null,
        trade_licence_authority: patch.tradeAuthority ?? null,
        trade_licence_no: patch.tradeLicenceNo ?? null,
        contract_start_date: patch.contractStart ?? null,
        target_go_live: patch.targetGoLive ?? null,
        expected_onboarding_days: patch.expectedDays ?? null,
      });
    }
    const res = await markSignedAction(clientId, templateId, amId);
    clearInterval(timer);
    setSigning((s) => (s ? { ...s, step: SIGN_STEPS.length - 1 } : s));
    setTimeout(() => {
      setSigning(null);
      if (res.runId) {
        showToast(`Onboarding run created for ${name}`);
        router.push(`/onboarding/${res.runId}`);
      } else {
        showToast(res.error ?? "Could not create run", "red");
      }
    }, 800);
  };

  const openClient = (c: ClientRow) => {
    router.push(`/clients/${c.id}`);
  };

  return (
    <div className="scroll">
      <div className="page">
        <div className="bk-title-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 className="bk-title">Clients</h1>
            <div className="bk-subtitle">All clients and their onboarding status · {clients.length} total</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={() => router.push("/clients/new-group")} title="Multiple companies sharing one owner / proposal">
              <Icon name="users" size={15} /> Add client group
            </button>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={15} /> Add client
            </button>
          </div>
        </div>

        <div className="bk-table-card" style={{ marginTop: 16 }}>
          <div className="bk-pill-tabs">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                className={"tab-pill" + (tab === t ? " active" : "")}
                onClick={() => setTab(t)}
              >
                {t} <span className="bk-tab-count">{tabCounts[t]}</span>
              </button>
            ))}
          </div>
          <div className="bk-pill-tabs bk-pill-tabs-secondary">
            {QUICK_TABS.map((t) => (
              <button
                key={t}
                className={"tab-pill" + (tab === t ? " active" : "")}
                onClick={() => setTab(t)}
              >
                {t} <span className="bk-tab-count">{tabCounts[t]}</span>
              </button>
            ))}
          </div>

          <div className="bk-toolbar">
            <div className="bk-toolbar-row">
              <div className="bk-search">
                <Icon name="search" size={16} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients…"
                />
              </div>

              {industryOpts.length > 0 && (
                <label className="bk-select-wrap">
                  <select className="bk-select" value={fIndustry} onChange={(e) => setFIndustry(e.target.value)}>
                    <option value="all">All industries</option>
                    {industryOpts.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                  <Icon name="chevron-down" size={13} className="bk-select-chev" />
                </label>
              )}
              <label className="bk-select-wrap">
                <select className="bk-select" value={fEntity} onChange={(e) => setFEntity(e.target.value)}>
                  <option value="all">All entities</option>
                  {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Icon name="chevron-down" size={13} className="bk-select-chev" />
              </label>
              {authorityOpts.length > 0 && (
                <label className="bk-select-wrap">
                  <select className="bk-select" value={fAuthority} onChange={(e) => setFAuthority(e.target.value)}>
                    <option value="all">All authorities</option>
                    {authorityOpts.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <Icon name="chevron-down" size={13} className="bk-select-chev" />
                </label>
              )}
              {teamLeadOpts.length > 0 && (
                <label className="bk-select-wrap">
                  <select className="bk-select" value={fTeamLead} onChange={(e) => setFTeamLead(e.target.value)}>
                    <option value="all">All team leads</option>
                    {teamLeadOpts.map((tl) => <option key={tl} value={tl}>{tl}</option>)}
                  </select>
                  <Icon name="chevron-down" size={13} className="bk-select-chev" />
                </label>
              )}
              <label className="bk-select-wrap">
                <select className="bk-select" value={fFrequency} onChange={(e) => setFFrequency(e.target.value)}>
                  <option value="all">All frequencies</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
                <Icon name="chevron-down" size={13} className="bk-select-chev" />
              </label>
              {monthOpts.length > 0 && (
                <label className="bk-select-wrap">
                  <select className="bk-select" value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                    <option value="all">All months</option>
                    {monthOpts.map((m) => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</option>)}
                  </select>
                  <Icon name="chevron-down" size={13} className="bk-select-chev" />
                </label>
              )}

              <div className="bk-spacer" />

              <div style={{ position: "relative" }}>
                <button className="btn-ghost bk-toolbar-btn" onClick={() => setColsOpen((v) => !v)} title="Show / hide columns">
                  <Icon name="columns" size={13} /> Columns
                </button>
                {colsOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.10)", padding: "8px 10px", zIndex: 10, minWidth: 200 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", marginBottom: 6 }}>Visible columns</div>
                    {ALL_COLS.filter((c) => !c.admin || masterAdmin).map((c) => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={visibleCols.has(c.id)} onChange={() => toggleCol(c.id)} />
                        {c.label}
                      </label>
                    ))}
                    <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6, fontSize: 11, color: "var(--ink-3)" }}>
                      Client, Status &amp; Actions always visible.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {hasFilters && (
              <div className="bk-chips">
                <span className="bk-chips-label">Filters active</span>
                <button className="bk-chip-clear" onClick={clearFilters}>Clear all</button>
              </div>
            )}
          </div>

          {selected.size > 0 && (canManageStatus || canDelete) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--orange-soft)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
              {canManageStatus && <>
                <button className="btn-ghost" onClick={() => bulkStatus("active", "reactivated")}><Icon name="play" size={13} /> Reactivate</button>
                <button className="btn-ghost" onClick={() => bulkStatus("hold", "put on hold")}><Icon name="pause" size={13} /> Hold</button>
                <button className="btn-ghost" onClick={() => bulkStatus("paused", "paused")}><Icon name="pause-circle" size={13} /> Pause</button>
                <button className="btn-ghost" style={{ color: "#d97706" }} onClick={() => bulkStatus("lead", "reverted to lead")}><Icon name="undo-2" size={13} /> Revert to lead</button>
              </>}
              {canDelete && <button className="btn-ghost" style={{ color: "var(--red)" }} onClick={() => setBulkConfirm(true)}><Icon name="trash-2" size={13} /> Delete</button>}
              <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={clearSel}>Clear</button>
            </div>
          )}
          <div className="bk-table-wrap">
          <table className="bk-table">
            <thead>
              <tr>
                {(canManageStatus || canDelete) && (
                  <th style={{ width: 34 }}>
                    <input type="checkbox" aria-label="Select all"
                      checked={filteredRows.filter((r) => r.kind !== "group-header").length > 0 && filteredRows.filter((r) => r.kind !== "group-header").every((r) => selected.has((r as { client: ClientRow }).client.id))}
                      onChange={(e) => { e.stopPropagation(); const ids = filteredRows.filter((r) => r.kind !== "group-header").map((r) => (r as { client: ClientRow }).client.id); setSelected(e.target.checked ? new Set(ids) : new Set()); }} />
                  </th>
                )}
                <th>Client</th>
                {masterAdmin && show("code") && <th>Code</th>}
                {show("industry") && <th>Industry</th>}
                {show("frequency") && <th>Report frequency</th>}
                {masterAdmin && show("team") && <th>Team Lead / Senior</th>}
                {show("services") && <th>Services</th>}
                <th>Status</th>
                {show("progress") && <th>Progress</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (() => {
                let span = 3;
                if (canManageStatus || canDelete) span++;
                if (masterAdmin && show("code")) span++;
                if (show("industry")) span++;
                if (show("frequency")) span++;
                if (masterAdmin && show("team")) span++;
                if (show("services")) span++;
                if (show("progress")) span++;
                return (
                  <tr>
                    <td colSpan={span} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>
                      No clients match.
                    </td>
                  </tr>
                );
              })()}
              {filteredRows.map((row) => {
                if (row.kind === "group-header") {
                  const expanded = expandedGroups.has(row.groupId);
                  const visibleCount = row.children.length;
                  let span = 3;
                  if (canManageStatus || canDelete) span++;
                  if (masterAdmin && show("code")) span++;
                  if (show("industry")) span++;
                if (show("frequency")) span++;
                  if (masterAdmin && show("team")) span++;
                  if (show("services")) span++;
                  if (show("progress")) span++;
                  return (
                    <tr key={`group-${row.groupId}`} onClick={() => toggleGroup(row.groupId)} style={{ background: "var(--bg-soft)", cursor: "pointer" }}>
                      {(canManageStatus || canDelete) && <td />}
                      <td colSpan={span - (canManageStatus || canDelete ? 1 : 0)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                          <span style={{ color: "var(--orange)", display: "flex", alignItems: "center" }}>
                            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                          </span>
                          <Icon name="users" size={14} style={{ color: "var(--ink-3)" }} />
                          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-1)" }}>{row.groupName}</span>
                          <span className="pill gray" style={{ fontSize: 10.5, padding: "1px 7px" }}>
                            {visibleCount} {visibleCount === 1 ? "company" : "companies"}
                          </span>
                          {canDelete && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDelGroup({ id: row.groupId, name: row.groupName, count: row.children.length }); }}
                              style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer" }}
                            >
                              Delete group
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }

                const c = row.kind === "group-child" ? row.client : row.client;
                const isChild = row.kind === "group-child";
                const run = runByClient[c.id];
                return (
                  <tr key={c.id} onClick={() => openClient(c)} style={isChild ? { background: "var(--bg-soft)" } : undefined}>
                    {(canManageStatus || canDelete) && (
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 34 }}>
                        <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} />
                      </td>
                    )}
                    <td>
                      <div className="bk-table-client" style={isChild ? { paddingLeft: 24 } : undefined}>
                        <div className="bk-table-client-name">
                          {isChild && <span style={{ color: "var(--ink-4)", fontSize: 11, flexShrink: 0 }}>└</span>}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                          {!c.profile_complete && <ProfileIncompletePopover client={c} />}
                        </div>
                        {masterAdmin && c.custom_code && (
                          <div className="bk-table-client-code">{c.custom_code}</div>
                        )}
                        <div className="bk-table-client-owner">{c.owner_name ?? "—"}</div>
                      </div>
                    </td>
                    {masterAdmin && show("code") && (
                      <td>
                        {c.custom_code
                          ? <span style={{ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: 11, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 7px", color: /-TBD(-|$)/.test(c.custom_code) ? "var(--orange)" : "var(--ink-2)" }} title={/-TBD(-|$)/.test(c.custom_code) ? "Add Trade Licence # / contract start to complete this code" : c.custom_code}>{c.custom_code}</span>
                          : <span style={{ fontSize: 11, color: "var(--ink-4)" }}>—</span>}
                      </td>
                    )}
                    {show("industry") && <td>{c.industry ?? "—"}</td>}
                    {show("frequency") && <td style={{ textTransform: "capitalize" }}>{c.report_frequency ?? "monthly"}</td>}
                    {masterAdmin && show("team") && (() => {
                      const t = teamByClient[c.id];
                      const tlNames = t?.teamLeads ?? [];
                      const srNames = t?.seniors ?? [];
                      return (
                        <td>
                          <div className="bk-team-cell">
                            {tlNames.length ? <div><span className="lbl">TL:</span>{tlNames.join(", ")}</div> : null}
                            {srNames.length ? <div><span className="lbl">Sr:</span>{srNames.join(", ")}</div> : null}
                            {!tlNames.length && !srNames.length && <span style={{ color: "var(--ink-4)" }}>—</span>}
                          </div>
                        </td>
                      );
                    })()}
                    {show("services") && (
                      <td>
                        <div className="bk-service-chips">
                          {(c.services ?? []).length === 0 && <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>}
                          {(c.services ?? []).map((s) => (
                            <span key={s} className="pill gray" style={{ fontSize: 10.5, padding: "2px 8px" }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    )}
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        <span className={"pill " + STATUS_PILL[c.status]}>
                          <span className="dot" /> {STATUS_LABEL[c.status]}
                        </span>
                        {(() => {
                          const intake = intakeByClient[c.id];
                          if (!intake?.sent) return null;
                          if (intake.submitted) return (
                            <span className="pill green" style={{ fontSize: 10, padding: "1px 7px" }} title={intake.submittedAt ? `Submitted ${new Date(intake.submittedAt).toLocaleDateString()}` : "Intake submitted"}>
                              <Icon name="check-circle" size={10} /> Intake submitted
                            </span>
                          );
                          return (
                            <span className="pill blue" style={{ fontSize: 10, padding: "1px 7px" }} title="Standalone intake link sent — awaiting client">
                              <Icon name="send" size={10} /> Intake sent
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    {show("progress") && (
                      <td>
                        {run ? (
                          <div className="progress-wrap">
                            <div className="progress orange">
                              <i style={{ width: `${run.progress}%` }} />
                            </div>
                            <span className="progress-pct">{run.progress}%</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>
                        )}
                      </td>
                    )}
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        {run ? (
                          <>
                            <button className="btn-ghost" onClick={() => router.push(`/onboarding/${run.id}`)}>
                              Open run <Icon name="arrow-right" size={13} />
                            </button>
                            {(c.status === "active" || c.status === "hold" || c.status === "paused" || c.status === "signed" || c.status === "onboarding") && (
                              amlAssignedClientIds.has(c.id) ? (
                                <span
                                  style={{ fontSize: 12, color: "#15803d", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 6, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
                                  title="AML review already assigned"
                                >
                                  <Icon name="check-circle" size={12} /> AML Done
                                </span>
                              ) : (
                                <button
                                  className="btn-ghost"
                                  style={{ fontSize: 12, color: "#7c3aed", borderColor: "#c4b5fd", padding: "4px 10px" }}
                                  title="Assign to AML compliance team"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const res = await assignToAmlAction(c.id);
                                    if (res.error) showToast(res.error, "red");
                                    else showToast(`${c.name} assigned to AML compliance`);
                                  }}
                                >
                                  <Icon name="file-lock" size={12} /> AML
                                </button>
                              )
                            )}
                          </>
                        ) : c.status === "lead" || c.status === "signed" ? (
                          <button className="btn-primary" onClick={() => setPickingAm({ clientId: c.id, name: c.name, ownerName: c.owner_name, industry: c.industry, entityType: c.entity_type, services: c.services, amId: c.am_id, email: c.primary_contact_email, phone: c.phone, proposalId: c.proposal_id, tradeAuthority: c.trade_licence_authority, tradeLicenceNo: c.trade_licence_no, contractStart: c.contract_start_date, targetGoLive: c.target_go_live, expectedDays: c.expected_onboarding_days })}>
                            Mark as Signed
                          </button>
                        ) : null}
                        {(canManageStatus || canDelete) && (
                          <div style={{ position: "relative" }}>
                            <button
                              className="btn-ghost"
                              style={{ padding: "6px 8px" }}
                              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuFor(menuFor?.id === c.id ? null : { id: c.id, x: r.right, y: r.bottom }); }}
                              aria-label="More actions"
                            >
                              <Icon name="more-horizontal" size={16} />
                            </button>
                            {menuFor?.id === c.id && (
                              <>
                                <div style={{ position: "fixed", inset: 0, zIndex: 60 }} onClick={() => setMenuFor(null)} />
                                <div className="menu-pop" style={{ position: "fixed", right: Math.max(8, window.innerWidth - menuFor.x), top: menuFor.y + 4, zIndex: 61, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.12)", padding: 6, minWidth: 196, textAlign: "left" }}>
                                  <MenuItem icon="send" label="Send intake form" onClick={() => { setMenuFor(null); setIntakeFor({ clientId: c.id, name: c.name }); }} />
                                  <MenuItem icon="copy" label="Duplicate client" onClick={() => doCopyClient(c.id, c.name)} />
                                  <MenuItem icon="user-cog" label="Change AM" onClick={() => { setMenuFor(null); setChangeAmFor({ clientId: c.id, name: c.name, currentAmId: c.am_id }); }} />
                                  {canManageStatus && (
                                    <>
                                      {c.status !== "hold" && (
                                        <MenuItem icon="pause" label="Put on hold" onClick={() => changeStatus(c.id, "hold", `${c.name} put on hold`)} />
                                      )}
                                      {c.status !== "paused" && (
                                        <MenuItem icon="pause-circle" label="Pause client" onClick={() => changeStatus(c.id, "paused", `${c.name} paused`)} />
                                      )}
                                      {(c.status === "hold" || c.status === "paused" || c.status === "inactive") && (
                                        <MenuItem icon="play" label="Reactivate" onClick={() => changeStatus(c.id, "active", `${c.name} reactivated`)} />
                                      )}
                                    </>
                                  )}
                                  {/* AML review is handled via the AML Compliance panel — no run required */}
                                  {canDelete && run && (
                                    <MenuItem icon="trash-2" danger label="Delete onboarding run" onClick={() => { setMenuFor(null); setConfirmDel({ kind: "run", id: run.id, name: c.name }); }} />
                                  )}
                                  {canDelete && (
                                    <MenuItem icon="trash-2" danger label="Delete client" onClick={() => { setMenuFor(null); setConfirmDel({ kind: "client", id: c.id, name: c.name }); }} />
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {addOpen && (
        <AddClientModal
          members={members}
          onClose={() => setAddOpen(false)}
          onCreated={(name) => {
            setAddOpen(false);
            showToast(`${name} added as a lead`);
            router.refresh();
          }}
          onMarkSigned={(clientId, p) => {
            setAddOpen(false);
            setPickingAm({ clientId, name: p.name, ownerName: p.ownerName, industry: p.industry, entityType: p.entityType, services: p.services, amId: p.amId, email: p.email, phone: p.phone, proposalId: p.proposalId, tradeAuthority: p.tradeAuthority, tradeLicenceNo: p.tradeLicenceNo, contractStart: p.contractStart, targetGoLive: p.targetGoLive, expectedDays: p.expectedDays });
          }}
        />
      )}

      {/* Step 1: full configure + AM before template */}
      {pickingAm && (
        <SignClientModal
          clientId={pickingAm.clientId}
          name={pickingAm.name}
          ownerName={pickingAm.ownerName}
          industry={pickingAm.industry}
          entityType={pickingAm.entityType}
          services={pickingAm.services}
          currentAmId={pickingAm.amId}
          email={pickingAm.email}
          phone={pickingAm.phone}
          proposalId={pickingAm.proposalId}
          tradeAuthority={pickingAm.tradeAuthority}
          tradeLicenceNo={pickingAm.tradeLicenceNo}
          contractStart={pickingAm.contractStart}
          targetGoLive={pickingAm.targetGoLive}
          expectedDays={pickingAm.expectedDays}
          members={members}
          onClose={() => setPickingAm(null)}
          onNext={(amId, patch) => {
            setPickingAm(null);
            setPicking({ clientId: pickingAm.clientId, name: pickingAm.name, amId, patch });
          }}
        />
      )}

      {picking && (
        <div className="modal-overlay open" onClick={() => setPicking(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Choose an onboarding template</h3>
              <div className="sub">Pick the flow for {picking.name}. This sets the stages and steps for the run.</div>
            </div>
            <div className="bd">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className="next-card"
                  onClick={() => runMarkSigned(picking.clientId, picking.name, t.id, picking.amId, (picking as any).patch)}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name={t.id === "medium-enterprise" ? "building-2" : t.id.startsWith("micro") ? "zap" : "users"} size={17} />
                  </span>
                  <span>
                    <span className="ttl">{t.name} <span style={{ color: "var(--ink-4)", fontWeight: 500 }}>· {t.stages} stages</span></span>
                    <span className="desc">{t.desc}</span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>
              ))}
              {templates.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No templates available.</div>}
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setPicking(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {signing && (
        <div className="modal-overlay open" style={{ zIndex: 80 }}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Signing {signing.name}</h3>
              <div className="sub">Setting up the onboarding run…</div>
            </div>
            <div className="bd">
              {SIGN_STEPS.map((label, i) => {
                const done = i < signing.step || signing.step === SIGN_STEPS.length - 1;
                const active = i === signing.step && signing.step < SIGN_STEPS.length - 1;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: done ? "var(--ink-1)" : "var(--ink-3)" }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: done ? "var(--green)" : active ? "var(--orange)" : "var(--bg)", color: done || active ? "#fff" : "var(--ink-4)", border: done || active ? "none" : "1.5px solid var(--border-strong)" }}>
                      {done ? <Icon name="check" size={11} /> : active ? "" : ""}
                    </span>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busy && setConfirmDel(null)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>{confirmDel.kind === "client" ? "Delete client?" : "Delete onboarding run?"}</h3>
              <div className="sub">
                {confirmDel.kind === "client"
                  ? `This permanently deletes ${confirmDel.name} and ALL related onboarding runs, tasks, documents and messages. This cannot be undone.`
                  : `This permanently deletes the onboarding run for ${confirmDel.name} (steps, tasks, messages). The client stays. This cannot be undone.`}
              </div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
              <button className="btn-danger" onClick={doDelete} disabled={busy}>
                {busy ? "Deleting…" : confirmDel.kind === "client" ? "Delete client" : "Delete run"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelGroup && (
        <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busy && setConfirmDelGroup(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Delete group &ldquo;{confirmDelGroup.name}&rdquo;?</h3>
              <div className="sub">
                This permanently deletes the group and all {confirmDelGroup.count} {confirmDelGroup.count === 1 ? "company" : "companies"} inside it, along with ALL their onboarding runs, tasks, documents and messages. This cannot be undone.
              </div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setConfirmDelGroup(null)} disabled={busy}>Cancel</button>
              <button className="btn-danger" disabled={busy} onClick={async () => {
                setBusy(true);
                const res = await deleteClientGroup(confirmDelGroup.id);
                setBusy(false);
                setConfirmDelGroup(null);
                if (res.error) showToast(res.error, "red");
                else { showToast(`Group and ${res.deleted ?? confirmDelGroup.count} clients deleted`); router.refresh(); }
              }}>
                {busy ? "Deleting…" : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busy && setBulkConfirm(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Delete {selected.size} clients?</h3>
              <div className="sub">This permanently deletes the {selected.size} selected clients and ALL their onboarding runs, tasks, documents and messages. This cannot be undone.</div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setBulkConfirm(false)} disabled={busy}>Cancel</button>
              <button className="btn-danger" onClick={bulkDelete} disabled={busy}>{busy ? "Deleting…" : `Delete ${selected.size} clients`}</button>
            </div>
          </div>
        </div>
      )}

      {intakeFor && (
        <IntakeSendModal
          clientId={intakeFor.clientId}
          clientName={intakeFor.name}
          onClose={() => setIntakeFor(null)}
          onSent={(msg) => { setIntakeFor(null); showToast(msg); }}
        />
      )}

      {changeAmFor && (
        <ChangeAmModal
          clientName={changeAmFor.name}
          currentAmId={changeAmFor.currentAmId}
          members={members}
          onClose={() => setChangeAmFor(null)}
          onSave={(newAmId) => doChangeAm(changeAmFor.clientId, newAmId, changeAmFor.name)}
        />
      )}

      {toast && (
        <div className={"toast show " + toast.kind}>
          <Icon name="check-circle" size={15} />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function ProfileIncompletePopover({ client }: { client: ClientRow }) {
  const [open, setOpen] = useState(false);

  const FIELDS: { label: string; value: string | null | undefined | string[] }[] = [
    { label: "Owner / Contact name", value: client.owner_name },
    { label: "Email", value: client.primary_contact_email },
    { label: "Industry", value: client.industry },
    { label: "Entity type", value: client.entity_type },
    { label: "Services", value: client.services?.length ? client.services.join(", ") : null },
    { label: "Trade licence no.", value: client.trade_licence_no },
    { label: "Contract start date", value: client.contract_start_date },
    { label: "Trade licence authority", value: client.trade_licence_authority },
  ];

  const missing = FIELDS.filter((f) => {
    const v = f.value;
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="pill amber"
        style={{ fontSize: 10, padding: "1px 7px", cursor: "pointer", border: "none", background: "none" }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Click to see missing fields"
      >
        Profile incomplete
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "12px 14px",
              minWidth: 240, maxWidth: 300,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>
              Missing details
            </div>
            {missing.length === 0 ? (
              <div style={{ fontSize: 12, color: "#15803d" }}>All fields filled — intake may not have been submitted yet.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                {missing.map((f) => (
                  <li key={f.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#fee2e2", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name="x" size={10} style={{ color: "#b91c1c" }} />
                    </span>
                    <span style={{ color: "#374151" }}>{f.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #f1f5f9", fontSize: 11, color: "#94a3b8" }}>
              Open the client profile to fill these in.
            </div>
          </div>
        </>
      )}
    </span>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 7,
        fontSize: 13,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: danger ? "var(--red)" : "var(--ink-1)",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--red-soft)" : "var(--bg)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={15} /> {label}
    </button>
  );
}

function IntakeSendModal({
  clientId,
  clientName,
  onClose,
  onSent,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [prep, setPrep] = useState<StandaloneIntakePrep | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"email" | "whatsapp" | "link">("email");
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Load the prep payload (URL + email + WhatsApp templates) when the modal opens.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const r = await prepareStandaloneIntake(clientId);
      if (!alive) return;
      setLoading(false);
      if (r.error || !r.data) { setErr(r.error ?? "Couldn't prepare the intake."); return; }
      setPrep(r.data);
      setTo(r.data.clientEmail ?? "");
      setSubject(r.data.subject);
      setBody(r.data.body);
      setWhatsapp(r.data.whatsapp);
    })();
    return () => { alive = false; };
  }, [clientId]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => { setOkMsg(`${label} copied`); setTimeout(() => setOkMsg(null), 1800); });
  };

  const sendEmail = async () => {
    setErr(null);
    if (!to.trim()) { setErr("Add the client's email first."); return; }
    setSending(true);
    const r = await sendStandaloneIntakeEmail(clientId, to, subject, body);
    setSending(false);
    if (r.error) { setErr(r.error); return; }
    onSent(`Intake email sent to ${to.trim()}`);
  };

  const openWhatsapp = () => {
    if (!prep) return;
    const url = `https://wa.me/?text=${encodeURIComponent(whatsapp)}`;
    window.open(url, "_blank", "noopener");
    setOkMsg("WhatsApp opened in a new tab");
    setTimeout(() => setOkMsg(null), 1800);
  };

  return (
    <div className="modal-overlay open" onClick={() => !sending && onClose()}>
      <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Send intake form — {clientName}</h3>
          <div className="sub">Preview and edit the message, then send it via your connected Gmail or open it in WhatsApp. The client opens the link with no login required.</div>
        </div>
        <div className="bd">
          {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Generating the public link…</div>}
          {err && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8, marginBottom: 10 }}>{err}</div>}
          {prep && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", background: "var(--bg-soft)", borderRadius: 8, marginBottom: 12, border: "1px solid var(--border)" }}>
                <Icon name="link" size={14} />
                <span style={{ flex: 1, fontFamily: "DM Mono, monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prep.url}</span>
                <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => copy(prep.url, "Link")}><Icon name="copy" size={12} /> Copy</button>
                <a className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12, textDecoration: "none" }} href={prep.url} target="_blank" rel="noopener noreferrer"><Icon name="external-link" size={12} /> Open</a>
              </div>

              <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
                {([
                  { id: "email", label: "Email" },
                  { id: "whatsapp", label: "WhatsApp" },
                  { id: "link", label: "Link only" },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      padding: "8px 14px",
                      border: "none",
                      background: "transparent",
                      borderBottom: tab === t.id ? "2px solid var(--ink-1)" : "2px solid transparent",
                      fontSize: 13,
                      fontWeight: tab === t.id ? 700 : 500,
                      color: tab === t.id ? "var(--ink-1)" : "var(--ink-3)",
                      cursor: "pointer",
                    }}
                  >{t.label}</button>
                ))}
              </div>

              {tab === "email" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="field"><label>To</label><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@company.com" /></div>
                  <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
                  <div className="field"><label>Body</label><textarea className="notes" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 200 }} /></div>
                </div>
              )}

              {tab === "whatsapp" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="field"><label>Message</label><textarea className="notes" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} style={{ minHeight: 200 }} /></div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>WhatsApp opens with this text — paste the client&apos;s number once it&apos;s open, or pick from your contacts.</div>
                </div>
              )}

              {tab === "link" && (
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  Just share the link above on any channel. The client opens it and fills the form — no login, no password. Their submissions land in this client&apos;s playbook automatically.
                </div>
              )}

              {okMsg && <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 8 }}>{okMsg}</div>}
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={sending}>Close</button>
          {prep && tab === "email" && (
            <>
              <button className="btn-ghost" onClick={() => copy(`${subject}\n\n${body}`, "Email")}><Icon name="copy" size={13} /> Copy email</button>
              <button className="btn-primary" onClick={sendEmail} disabled={sending || !to.trim()}>
                <Icon name="send" size={13} /> {sending ? "Sending…" : "Send via my Gmail"}
              </button>
            </>
          )}
          {prep && tab === "whatsapp" && (
            <>
              <button className="btn-ghost" onClick={() => copy(whatsapp, "WhatsApp message")}><Icon name="copy" size={13} /> Copy message</button>
              <button className="btn-primary" onClick={openWhatsapp}><Icon name="external-link" size={13} /> Open in WhatsApp</button>
            </>
          )}
          {prep && tab === "link" && (
            <button className="btn-primary" onClick={() => copy(prep.url, "Link")}><Icon name="copy" size={13} /> Copy link</button>
          )}
        </div>
      </div>
      <style jsx>{`
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 100; display: flex; align-items: center; justify-content: center; }
        .modal { background: var(--surface); border-radius: 14px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 12px 60px rgba(0,0,0,.18); }
        .hd { padding: 18px 22px 6px; }
        .hd h3 { margin: 0 0 4px; font-size: 17px; }
        .hd .sub { font-size: 12.5px; color: var(--ink-3); line-height: 1.45; }
        .bd { padding: 14px 22px; overflow: auto; }
        .ft { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
      `}</style>
    </div>
  );
}

const ROLE_SHORT: Record<string, string> = {
  admin: "Admin", ops_head: "Ops Head", am: "AM", team_lead: "Team Lead",
  senior: "Senior", junior: "Junior", associate: "Associate", intern: "Intern", other: "Team",
};

function SignClientModal({
  name,
  ownerName: initOwnerName,
  industry: initIndustry,
  entityType: initEntityType,
  services: initServices,
  currentAmId,
  email: initEmail,
  phone: initPhone,
  proposalId: initProposalId,
  tradeAuthority: initTradeAuthority,
  tradeLicenceNo: initTradeLicenceNo,
  contractStart: initContractStart,
  targetGoLive: initTargetGoLive,
  expectedDays: initExpectedDays,
  members,
  onClose,
  onNext,
}: {
  clientId: string;
  name: string;
  ownerName: string | null;
  industry: string | null;
  entityType: string | null;
  services: string[] | null;
  currentAmId: string | null;
  email: string | null;
  phone: string | null;
  proposalId: string | null;
  tradeAuthority: string | null;
  tradeLicenceNo: string | null;
  contractStart: string | null;
  targetGoLive: string | null;
  expectedDays: number | null;
  members: AmOption[];
  onClose: () => void;
  onNext: (amId: string, patch: { ownerName: string | null; industry: string | null; entityType: string | null; services: string[]; email: string | null; phone: string | null; proposalId: string | null; tradeAuthority: string | null; tradeLicenceNo: string | null; contractStart: string | null; targetGoLive: string | null; expectedDays: number | null }) => void;
}) {
  const [ownerName, setOwnerName] = useState(initOwnerName ?? "");
  const [industry, setIndustry] = useState(initIndustry ?? "");
  const [entityType, setEntityType] = useState(initEntityType ?? "");
  const [services, setServices] = useState<string[]>(initServices ?? []);
  const [amId, setAmId] = useState(currentAmId ?? "");
  const [email, setEmail] = useState(initEmail ?? "");
  const [phone, setPhone] = useState(initPhone ?? "");
  const [proposalId, setProposalId] = useState(initProposalId ?? "");
  const [tradeAuthority, setTradeAuthority] = useState(initTradeAuthority ?? "");
  const [tradeLicenceNo, setTradeLicenceNo] = useState(initTradeLicenceNo ?? "");
  const [contractStart, setContractStart] = useState((initContractStart ?? "").slice(0, 7));
  const [targetGoLive, setTargetGoLive] = useState(initTargetGoLive ?? "");
  const [expectedDays, setExpectedDays] = useState<string>(initExpectedDays != null ? String(initExpectedDays) : "");

  const toggleService = (s: string) =>
    setServices((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const eligible = members.filter((m) => ["am", "team_lead", "ops_head", "admin"].includes(m.role));

  const handleNext = () => {
    if (!amId) return;
    onNext(amId, {
      ownerName: ownerName || null,
      industry: industry || null,
      entityType: entityType || null,
      services,
      email: email || null,
      phone: phone || null,
      proposalId: proposalId || null,
      tradeAuthority: tradeAuthority || null,
      tradeLicenceNo: tradeLicenceNo || null,
      contractStart: contractStart ? `${contractStart}-01` : null,
      targetGoLive: targetGoLive || null,
      expectedDays: expectedDays ? Number(expectedDays) : null,
    });
  };

  return (
    <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Confirm &amp; Sign</h3>
          <div className="sub">Review all details for <strong>{name}</strong> before starting onboarding.</div>
        </div>
        <div className="bd">

          {/* Company */}
          <div className="field">
            <label>Company name</label>
            <input value={name} disabled style={{ opacity: 0.6, cursor: "not-allowed" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Owner / founder name</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Ahmed Al-Rashidi" />
            </div>
            <div className="field">
              <label>Proposal ID</label>
              <input value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="e.g. PROP-2026-0142" />
            </div>
          </div>

          {/* Contact */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Contact email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@company.com" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 000 0000" />
            </div>
          </div>

          {/* Business */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Industry</label>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Entity type</label>
              <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                <option value="">Select…</option>
                {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* Services */}
          <div className="field">
            <label>Services signed</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SERVICES.map((s) => (
                <button key={s} type="button" onClick={() => toggleService(s)}
                  className={"tab-pill" + (services.includes(s) ? " active" : "")}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Trade licence */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Issuing authority</label>
              <select value={tradeAuthority} onChange={(e) => setTradeAuthority(e.target.value)}>
                <option value="">Select…</option>
                {UAE_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Trade licence #</label>
              <input value={tradeLicenceNo} onChange={(e) => setTradeLicenceNo(e.target.value)} placeholder="e.g. 1234567" />
            </div>
          </div>

          {/* Timeline */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Service start (month)</label>
              <input type="month" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Target go-live</label>
              <input type="date" value={targetGoLive} onChange={(e) => setTargetGoLive(e.target.value)} />
            </div>
            <div className="field">
              <label>Onboarding days</label>
              <input type="number" value={expectedDays} onChange={(e) => setExpectedDays(e.target.value)} placeholder="28" min={1} />
            </div>
          </div>

          {/* AM */}
          <div className="field">
            <label>Account Manager (AM) *</label>
            <select value={amId} onChange={(e) => setAmId(e.target.value)}>
              <option value="">— Select AM —</option>
              {eligible.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name} · {ROLE_SHORT[m.role] ?? m.role}</option>
              ))}
            </select>
          </div>

        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleNext} disabled={!amId}>
            Next: Choose Template →
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeAmModal({
  clientName,
  currentAmId,
  members,
  onClose,
  onSave,
}: {
  clientName: string;
  currentAmId: string | null;
  members: AmOption[];
  onClose: () => void;
  onSave: (newAmId: string) => void;
}) {
  const [amId, setAmId] = useState(currentAmId ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await onSave(amId);
    setBusy(false);
  };
  return (
    <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={onClose}>
      <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Change Account Manager</h3>
          <div className="sub">{clientName}</div>
        </div>
        <div className="bd">
          <div className="field">
            <label>Account Manager</label>
            <select value={amId} onChange={(e) => setAmId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} · {ROLE_SHORT[m.role] ?? m.role}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !amId}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddClientModal({
  members,
  onClose,
  onCreated,
  onMarkSigned,
}: {
  members: AmOption[];
  onClose: () => void;
  onCreated: (name: string) => void;
  onMarkSigned: (clientId: string, prefill: { name: string; ownerName: string | null; industry: string | null; entityType: string | null; services: string[] | null; amId: string | null; email: string | null; phone: string | null; proposalId: string | null; tradeAuthority: string | null; tradeLicenceNo: string | null; contractStart: string | null; targetGoLive: string | null; expectedDays: number | null }) => void;
}) {
  const [form, setForm] = useState<NewClientInput>({ name: "", services: [], report_frequency: "monthly" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof NewClientInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const toggleService = (s: string) =>
    setForm((f) => ({
      ...f,
      services: f.services?.includes(s) ? f.services.filter((x) => x !== s) : [...(f.services ?? []), s],
    }));

  const submit = async (markSigned: boolean) => {
    if (!form.name.trim()) return setError("Company name is required.");
    setBusy(true);
    setError(null);
    const res = await createClientAction(form);
    setBusy(false);
    if (res.error) return setError(res.error);
    if (markSigned && res.clientId) onMarkSigned(res.clientId, { name: form.name.trim(), ownerName: form.owner_name ?? null, industry: form.industry ?? null, entityType: form.entity_type ?? null, services: form.services ?? null, amId: form.am_id ?? null, email: form.email ?? null, phone: form.phone ?? null, proposalId: form.proposal_id ?? null, tradeAuthority: form.trade_licence_authority ?? null, tradeLicenceNo: form.trade_licence_no ?? null, contractStart: form.contract_start_date ?? null, targetGoLive: form.target_go_live ?? null, expectedDays: form.expected_onboarding_days ?? null });
    else onCreated(form.name.trim());
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Add client</h3>
          <div className="sub">In production this comes from CRM. For now, add manually.</div>
        </div>
        <div className="bd">
          <div className="field">
            <label>Company name *</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Gulf Retail LLC" />
          </div>
          <div className="field">
            <label>Owner name</label>
            <input value={form.owner_name ?? ""} onChange={(e) => set("owner_name", e.target.value)} placeholder="Ahmed Al-Rashidi" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Industry</label>
              <select value={form.industry ?? ""} onChange={(e) => set("industry", e.target.value)}>
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Entity type</label>
              <select value={form.entity_type ?? ""} onChange={(e) => set("entity_type", e.target.value)}>
                <option value="">Select…</option>
                {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Report frequency *</label>
            <select value={form.report_frequency ?? "monthly"} onChange={(e) => set("report_frequency", e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
          <div className="field">
            <label>Services signed</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SERVICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleService(s)}
                  className={"tab-pill" + (form.services?.includes(s) ? " active" : "")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Account Manager (AM)</label>
            <select value={form.am_id ?? ""} onChange={(e) => set("am_id", e.target.value || undefined)}>
              <option value="">Assign me (default)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} · {ROLE_SHORT[m.role] ?? m.role}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Proposal ID</label>
            <input value={form.proposal_id ?? ""} onChange={(e) => set("proposal_id", e.target.value || undefined)} placeholder="e.g. PROP-2026-0142" />
          </div>
          <div className="field">
            <label>Issuing Authority</label>
            <select value={form.trade_licence_authority ?? ""} onChange={(e) => set("trade_licence_authority", e.target.value || undefined)}>
              <option value="">Select…</option>
              {UAE_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Trade Licence #</label>
              <input value={form.trade_licence_no ?? ""} onChange={(e) => set("trade_licence_no", e.target.value || undefined)} placeholder="e.g. 1234567" />
            </div>
            <div className="field">
              <label>Contract start (month)</label>
              <input type="month" value={(form.contract_start_date ?? "").slice(0, 7)} onChange={(e) => set("contract_start_date", e.target.value ? `${e.target.value}-01` : undefined)} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: -4 }}>
            Used to build the client code <code>F01-(licence)-(company)-(YYMM)</code>. Blank slots become TBD until filled.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Target go-live date</label>
              <input type="date" value={form.target_go_live ?? ""} onChange={(e) => set("target_go_live", e.target.value || undefined)} />
            </div>
            <div className="field">
              <label>Expected onboarding (days)</label>
              <input type="number" min={1} value={form.expected_onboarding_days ?? ""} onChange={(e) => set("expected_onboarding_days", e.target.value ? parseInt(e.target.value, 10) : undefined)} placeholder="e.g. 21" />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: -4 }}>
            Used to set the onboarding deadline and to track timelines for insights later.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Primary contact email</label>
              <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="ahmed@gulfretail.ae" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+971 50 …" />
            </div>
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{error}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-ghost" onClick={() => submit(false)} disabled={busy}>Save as lead</button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={busy}>
            {busy ? "Saving…" : "Mark as Signed"}
          </button>
        </div>
      </div>
    </div>
  );
}
