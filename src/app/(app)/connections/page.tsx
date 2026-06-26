import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MyConnections } from "./my-connections";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ zoho?: string; reason?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const role = s.teamMember?.role ?? s.profile?.role ?? "";
  const canBackfill = role === "admin" || role === "ops_head";
  const zohoStatus = sp.zoho ?? null;
  const zohoReason = sp.reason ?? null;
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
  return <MyConnections name={s.teamMember?.full_name ?? s.email ?? "You"} googleEmail={google} zohoConnected={zoho} fathomSet={fathom} linked={!!s.teamMember?.id} canBackfill={canBackfill} zohoStatus={zohoStatus} zohoReason={zohoReason} />;
}
