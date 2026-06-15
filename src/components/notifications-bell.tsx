"use client";

import { useCallback, useEffect, useState } from "react";
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
}

const KIND_COLOR: Record<string, string> = { escalation: "red", milestone: "green", task_tag: "teal", info: "blue" };

export function NotificationsBell({ memberId }: { memberId: string | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const supabase = createClient();

  const load = useCallback(async () => {
    let q = supabase.from("notifications").select("id,kind,title,body,read,created_at,recipient_id").order("created_at", { ascending: false }).limit(40);
    if (memberId) q = q.or(`recipient_id.eq.${memberId},recipient_id.is.null`);
    else q = q.is("recipient_id", null);
    const { data } = await q;
    setItems((data ?? []) as Notif[]);
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

  return (
    <>
      <button className={"icon-btn" + (unread > 0 ? " has-dot" : "")} onClick={openDrawer} aria-label="Notifications">
        <Icon name="bell" size={18} />
      </button>

      <div className={"drawer-overlay" + (open ? " open" : "")} onClick={() => setOpen(false)} />
      <aside className={"drawer" + (open ? " open" : "")}>
        <div className="hd">
          <h3>Action Centre</h3>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="list">
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--ink-3)", fontSize: 13 }}>You&apos;re all caught up.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={"act " + (KIND_COLOR[n.kind] ?? "teal")}>
                <div className="ttl">{n.title}</div>
                {n.body && <div className="desc">{n.body}</div>}
                <div className="meta">{new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
