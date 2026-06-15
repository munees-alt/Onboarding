"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/types";
import { createMember, updateMember, deleteMember, type MemberInput } from "./actions";

export interface OrgMember {
  id: string;
  full_name: string;
  email: string | null;
  title: string | null;
  role: Role;
  dept: string | null;
  location: string | null;
  reports_to: string | null;
  avatar_initials: string | null;
  avatar_color: string | null;
}
interface Node extends OrgMember { children: Node[]; depth: number }
type EditorState = { mode: "add" | "edit"; member?: OrgMember; parentId?: string | null } | null;

const ROLE_KEYS = Object.keys(ROLE_LABEL) as Role[];

export function OrgChartView({ members }: { members: OrgMember[] }) {
  const router = useRouter();
  const [view, setView] = useState<"diagram" | "tree">("diagram");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // default-collapse deep branches so the diagram stays readable
    const byId = new Map(members.map((m) => [m.id, m] as const));
    const depthOf = (m: OrgMember): number => { let d = 0, c: OrgMember | undefined = m; while (c?.reports_to && byId.get(c.reports_to)) { d++; c = byId.get(c.reports_to); } return d; };
    return new Set(members.filter((m) => depthOf(m) >= 2 && members.some((x) => x.reports_to === m.id)).map((m) => m.id));
  });

  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.error) note(r.error); else { note(ok); router.refresh(); } });
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const roots = useMemo(() => {
    const byId = new Map<string, Node>();
    members.forEach((m) => byId.set(m.id, { ...m, children: [], depth: 0 }));
    const top: Node[] = [];
    byId.forEach((n) => {
      const parent = n.reports_to ? byId.get(n.reports_to) : null;
      if (parent) parent.children.push(n);
      else top.push(n);
    });
    const setDepth = (n: Node, d: number) => { n.depth = d; n.children.forEach((c) => setDepth(c, d + 1)); };
    top.forEach((n) => setDepth(n, 0));
    return top;
  }, [members]);

  const q = search.trim().toLowerCase();
  const matches = q ? members.filter((m) => m.full_name.toLowerCase().includes(q) || (m.title ?? "").toLowerCase().includes(q) || (m.dept ?? "").toLowerCase().includes(q)) : [];

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: view === "diagram" ? "none" : 1100 }}>
        <div className="section-head">
          <div><h2>Org Chart</h2><div className="sub">{members.length} people · edit roles, add people, restructure reporting lines.</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person…" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px 7px 30px", fontSize: 13, width: 200, outline: "none" }} />
              <span style={{ position: "absolute", left: 9, top: 8, color: "var(--ink-3)" }}><Icon name="search" size={14} /></span>
            </div>
            <div className="seg">
              <button className={"seg-btn" + (view === "diagram" ? " active" : "")} onClick={() => setView("diagram")}>Diagram</button>
              <button className={"seg-btn" + (view === "tree" ? " active" : "")} onClick={() => setView("tree")}>List</button>
            </div>
            <button className="btn-primary" onClick={() => setEditor({ mode: "add", parentId: null })}><Icon name="user-plus" size={15} /> Add person</button>
          </div>
        </div>

        {q ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
            {matches.map((m) => <RowItem key={m.id} m={m} onEdit={() => setEditor({ mode: "edit", member: m })} onAdd={() => setEditor({ mode: "add", parentId: m.id })} onDelete={() => run(() => deleteMember(m.id), "Person removed")} busy={busy} />)}
            {!matches.length && <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)" }}>No match.</div>}
          </div>
        ) : view === "tree" ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
            {roots.map((n) => <TreeNode key={n.id} node={n} collapsed={collapsed} toggle={toggle} onEdit={(m) => setEditor({ mode: "edit", member: m })} onAdd={(id) => setEditor({ mode: "add", parentId: id })} onDelete={(id) => run(() => deleteMember(id), "Person removed")} busy={busy} />)}
          </div>
        ) : (
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-soft)", padding: 20 }}>
            <div className="orgtree" style={{ width: "max-content", margin: "0 auto" }}>
              <ul>{roots.map((n) => <DiagramNode key={n.id} node={n} collapsed={collapsed} toggle={toggle} onEdit={(m) => setEditor({ mode: "edit", member: m })} onAdd={(id) => setEditor({ mode: "add", parentId: id })} onDelete={(id) => run(() => deleteMember(id), "Person removed")} busy={busy} />)}</ul>
            </div>
          </div>
        )}
      </div>

      {editor && (
        <EditorModal
          state={editor}
          members={members}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={(input) => {
            const isEdit = editor.mode === "edit" && editor.member;
            run(() => (isEdit ? updateMember(editor.member!.id, input) : createMember(input)), isEdit ? "Updated" : "Person added");
            setEditor(null);
          }}
        />
      )}
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function Avatar({ m, size = 36 }: { m: OrgMember; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: m.avatar_color ?? "#6d7588", color: "#fff", display: "grid", placeItems: "center", fontSize: size * 0.34, fontWeight: 700, flexShrink: 0 }}>{m.avatar_initials ?? m.full_name.slice(0, 1)}</span>;
}

function Actions({ m, onEdit, onAdd, onDelete, busy }: { m: OrgMember; onEdit: () => void; onAdd: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <>
      <button className="icon-btn" title="Edit" onClick={onEdit} disabled={busy}><Icon name="pencil" size={13} /></button>
      <button className="icon-btn" title="Add report" onClick={onAdd} disabled={busy}><Icon name="user-plus" size={13} /></button>
      <button className="icon-btn" title="Remove" onClick={() => { if (confirm(`Remove ${m.full_name}?`)) onDelete(); }} disabled={busy} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
    </>
  );
}

function RowItem({ m, onEdit, onAdd, onDelete, busy }: { m: OrgMember; onEdit: () => void; onAdd: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px" }}>
      <Avatar m={m} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name}</div><div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.title ?? "—"}{m.dept ? ` · ${m.dept}` : ""}</div></div>
      <span className="pill gray" style={{ fontSize: 10 }}>{ROLE_LABEL[m.role]}</span>
      <Actions m={m} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete} busy={busy} />
    </div>
  );
}

interface NodeProps {
  node: Node;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onEdit: (m: OrgMember) => void;
  onAdd: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

function TreeNode({ node, collapsed, toggle, onEdit, onAdd, onDelete, busy }: NodeProps) {
  const hasKids = node.children.length > 0;
  const open = !collapsed.has(node.id);
  return (
    <div style={{ marginLeft: node.depth ? 22 : 0, borderLeft: node.depth ? "1px solid var(--border)" : "none", paddingLeft: node.depth ? 12 : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px" }}>
        {hasKids ? <button className="icon-btn" onClick={() => toggle(node.id)}><Icon name={open ? "chevron-down" : "chevron-right"} size={14} /></button> : <span style={{ width: 26 }} />}
        <Avatar m={node} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{node.full_name}</div><div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{node.title ?? "—"}{node.dept ? ` · ${node.dept}` : ""}</div></div>
        {hasKids && <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{node.children.length}</span>}
        <span className="pill gray" style={{ fontSize: 10 }}>{ROLE_LABEL[node.role]}</span>
        <Actions m={node} onEdit={() => onEdit(node)} onAdd={() => onAdd(node.id)} onDelete={() => onDelete(node.id)} busy={busy} />
      </div>
      {open && node.children.map((c) => <TreeNode key={c.id} node={c} collapsed={collapsed} toggle={toggle} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete} busy={busy} />)}
    </div>
  );
}

function DiagramNode({ node, collapsed, toggle, onEdit, onAdd, onDelete, busy }: NodeProps) {
  const hasKids = node.children.length > 0;
  const open = !collapsed.has(node.id);
  return (
    <li>
      <div className={"org-node" + (node.depth === 0 ? " is-root" : "")}>
        <div className="otop">
          <Avatar m={node} />
          <div style={{ minWidth: 0 }}>
            <div className="onm">{node.full_name}</div>
            <div className="orl">{node.title ?? ROLE_LABEL[node.role]}</div>
          </div>
        </div>
        <div style={{ padding: "0 12px 8px" }}><span className="pill gray" style={{ fontSize: 10 }}>{ROLE_LABEL[node.role]}</span></div>
        <div className="ofoot">
          <Actions m={node} onEdit={() => onEdit(node)} onAdd={() => onAdd(node.id)} onDelete={() => onDelete(node.id)} busy={busy} />
          {hasKids && <button className="ocount" onClick={() => toggle(node.id)}>{node.children.length}<Icon name={open ? "chevron-up" : "chevron-down"} size={10} /></button>}
        </div>
      </div>
      {hasKids && open && <ul>{node.children.map((c) => <DiagramNode key={c.id} node={c} collapsed={collapsed} toggle={toggle} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete} busy={busy} />)}</ul>}
    </li>
  );
}

function EditorModal({ state, members, busy, onClose, onSave }: { state: NonNullable<EditorState>; members: OrgMember[]; busy: boolean; onClose: () => void; onSave: (i: MemberInput) => void }) {
  const m = state.member;
  const [form, setForm] = useState<MemberInput>({
    full_name: m?.full_name ?? "",
    email: m?.email ?? "",
    title: m?.title ?? "",
    role: m?.role ?? "junior",
    dept: m?.dept ?? "",
    location: m?.location ?? "",
    reports_to: m?.reports_to ?? state.parentId ?? null,
  });
  const set = (k: keyof MemberInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{state.mode === "edit" ? "Edit person" : "Add person"}</h3></div>
        <div className="bd">
          <div className="field"><label>Full name *</label><input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Full name" /></div>
          <div className="field"><label>Work email <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>— lets them sign in with this role</span></label><input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="name@finanshels.com" /></div>
          <div className="field"><label>Title</label><input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior Accounting Advisor" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Role</label><select value={form.role} onChange={(e) => set("role", e.target.value as Role)}>{ROLE_KEYS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
            <div className="field"><label>Department</label><input value={form.dept ?? ""} onChange={(e) => set("dept", e.target.value)} placeholder="e.g. FinOps – Medium" /></div>
          </div>
          <div className="field"><label>Location</label><input value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Dubai" /></div>
          <div className="field"><label>Reports to</label>
            <select value={form.reports_to ?? ""} onChange={(e) => set("reports_to", e.target.value || null)}>
              <option value="">— Top of org —</option>
              {members.filter((x) => x.id !== m?.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.title ? ` · ${x.title}` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={() => form.full_name.trim() && onSave(form)} disabled={busy || !form.full_name.trim()}>{state.mode === "edit" ? "Save" : "Add person"}</button>
        </div>
      </div>
    </div>
  );
}
