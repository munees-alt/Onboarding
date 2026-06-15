import { requireSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createClient } from "@/lib/supabase/server";
import { TicketsView, type TicketRow } from "./tickets-view";

export default async function TicketsPage() {
  const s = await requireSession();
  if (!canOpenSettings(s.profile.role))
    return <Restricted message="Requests are reviewed by the Master Admin and Ops Head." />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("tickets")
    .select("id,kind,title,body,status,created_by_name,created_by_role,admin_note,created_at")
    .order("created_at", { ascending: false });

  return <TicketsView tickets={(data ?? []) as TicketRow[]} />;
}
