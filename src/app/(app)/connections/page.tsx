import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MyConnections } from "./my-connections";

export default async function ConnectionsPage() {
  const s = await requireSession();
  let google: string | null = null, zoho = false, fathom = false;
  if (s.teamMember?.id) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("member_connections")
      .select("provider,account_email,connected")
      .eq("team_member_id", s.teamMember.id);
    (data ?? []).forEach((c) => {
      if (c.provider === "google" && c.connected) google = c.account_email ?? "connected";
      if (c.provider === "zoho" && c.connected) zoho = true;
      if (c.provider === "fathom" && c.connected) fathom = true;
    });
  }
  return <MyConnections name={s.teamMember?.full_name ?? s.email ?? "You"} googleEmail={google} zohoConnected={zoho} fathomSet={fathom} linked={!!s.teamMember?.id} />;
}
