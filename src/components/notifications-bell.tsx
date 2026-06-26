"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icon";
import { createClient } from "@/lib/supabase/client";

interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
  recipient_id: string | null;
  run_id: string | null;
  client_id: string | null;
  client_name: string | null;
}

type RawRow = {
  id: string; kind: string; title: string; body: string | null; read: boolean;
  created_at: string; recipient_id: string | null; run_id: string | null;
  onboarding_runs:
    | { clients: { id: string; name: string } | { id: string; name: string }[] | null }
    | { clients: { id: string; name: string } | { id: string; name: string }[] | null }[]
    | null;
};

const KIND_COLOR: Record<string, string> = {
  escalation: "red", milestone: "green", task_tag: "teal", info: "blue",
  task_assigned: "teal",
};

const KIND_ICON: Record<string, string> = {
  escalation: "alert-triangle", milestone: "check-circle", task_tag: "tag", info: "info",
  task_assigned: "user-plus",
};

function unwrap<T>(x: T | T[] | null): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x;
}

export function NotificationsBell({ memberId }: { memberId: string | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [search, setSearch] = useState("");
  const [activeClient, setActiveClient] = useState<{ id: string; name: string } | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    let q = supabase
      .from("notifications")
      .select("id,kind,title,body,read,created_at,recipient_id,run_id,onboarding_runs(clients(id,name))")
      .order("created_at", { ascending: false })
      .limit(80);
    if (memberId) q = q.or(`recipient_id.eq.${memberId},recipient_id.is.null`);
    else q = q.is("recipient_id", null);
    const { data } = await q;
    const rows = ((data ?? []) as unknown as RawRow[]).map((r) => {
      const run = unwrap(r.onboarding_runs);
      const client = run ? unwrap(run.clients) : null;
      return {
        id: r.id, kind: r.kind, title: r.title, body: r.body, read: r.read,
        created_at: r.created_at, recipient_id: r.recipient_id, run_id: r.run_id,
        client_id: client?.id ?? null, client_name: client?.name ?? null,
      } satisfies Notif;
    });
    setItems(rows);
  }, [memberId, supabase]);

  useEffect(() => { load(); }, [load]);

  const unread = items.filter((n) => !n.read).length;

  const openDrawer = async () => {
    setOpen(true);
    await load();
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length) {
      await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
      setItems((arr) => arr.map((n) => ({ ...n, read: true })));
    }
  };

  // Group by client name when not filtered; flat list when a single client is selected.
  const filtered = useMemo(() => {
    let rows = items;
    if (activeClient) rows = rows.filter((n) => n.client_id === activeClient.id);
    else if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((n) =>
        (n.client_name ?? "").toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        (n.body ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [items, search, activeClient]);

  const groups = useMemo(() => {
    if (activeClient) return null; // flat list mode
    const map = new Map<string, { name: string; clientId: string | null; rows: Notif[] }>();
    for (const n of filtered) {
      const key = n.client_id ?? "__general";
      const name = n.client_name ?? "General · no client";
      if (!map.has(key)) map.set(key, { name, clientId: n.client_id, rows: [] });
      map.get(key)!.rows.push(n);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, activeClient]);

  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const close = () => {
    setOpen(false);
    setActiveClient(null);
    setSearch("");
  };

  return (
    <>
      <button className={"icon-btn" + (unread > 0 ? " has-dot" : "")} onClick={openDrawer} aria-label="Notifications">
        <Icon name="bell" size={18} />
      </button>

      <div className={"drawer-overlay" + (open ? " open" : "")} onClick={close} />
      <aside className={"drawer" + (open ? " open" : "")}>
        <div className="hd">
          <h3>Action Centre</h3>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div style={{ padding: "10px 14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {activeClient ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
              <Icon name="building-2" size={14} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{activeClient.name}</span>
              <button onClick={() => setActiveClient(null)} className="btn-ghost" style={{ marginLeft: "auto", fontSize: 11.5 }}>
                <Icon name="x" size={12} /> Clear
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <Icon name="search" size={13} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, title, or text…"
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "7px 10px 7px 30px",
                  fontSize: 13,
                  background: "#fff",
                }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }}>
                <Icon name="search" size={13} />
              </span>
            </div>
          )}
        </div>

        <div className="list" style={{ paddingTop: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--ink-3)", fontSize: 13 }}>
              {search.trim() || activeClient ? "Nothing matches that filter." : "You're all caught up."}
            </div>
          ) : activeClient ? (
            filtered.map((n) => <NotifCard key={n.id} n={n} fmtTime={fmtTime} hideClient />)
          ) : (
            (groups ?? []).map((g) => (
              <div key={g.name} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 14px",
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--ink-3)",
                    background: "var(--bg-soft)",
                    borderTop: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <Icon name={g.clientId ? "building-2" : "info"} size={12} />
                  <span style={{ color: "var(--ink-2)" }}>{g.name}</span>
                  <span style={{ marginLeft: 4, color: "var(--ink-3)", fontWeight: 600 }}>· {g.rows.length}</span>
                  {g.clientId && (
                    <button
                      onClick={() => setActiveClient({ id: g.clientId!, name: g.name })}
                      style={{
                        marginLeft: "auto", background: "transparent", border: "none",
                        color: "var(--orange)", fontWeight: 600, fontSize: 11, textTransform: "none", letterSpacing: 0, cursor: "pointer",
                      }}
                    >
                      View all →
                    </button>
                  )}
                </div>
                {g.rows.map((n) => <NotifCard key={n.id} n={n} fmtTime={fmtTime} hideClient />)}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function NotifCard({ n, fmtTime, hideClient }: { n: Notif; fmtTime: (s: string) => string; hideClient?: boolean }) {
  const color = KIND_COLOR[n.kind] ?? "teal";
  const icon = KIND_ICON[n.kind] ?? "bell";
  const href = n.run_id ? `/onboarding/${n.run_id}` : n.client_id ? `/clients/${n.client_id}` : null;
  const card = (
    <div className={"act " + color} style={{ position: "relative" }}>
      <div className="ttl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={13} />
        {n.title}
      </div>
      {n.body && <div className="desc">{n.body}</div>}
      <div className="meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!hideClient && n.client_name && (
          <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
            <Icon name="building-2" size={11} /> {n.client_name}
            <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>·</span>
          </span>
        )}
        <span>{fmtTime(n.created_at)}</span>
      </div>
    </div>
  );
  if (!href) return card;
  return (
    <a href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      {card}
    </a>
  );
}
