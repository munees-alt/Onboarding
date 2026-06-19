import { createAdminClient } from "@/lib/supabase/admin";
import { SalesUploadView } from "./sales-upload-view";

export const metadata = { title: "Finanshels — Share documents" };

export default async function SalesUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("magic_links")
    .select("client_id,expires_at,purpose")
    .eq("token", token)
    .eq("purpose", "sales_upload")
    .maybeSingle();
  const expired = !link || new Date(link.expires_at).getTime() < Date.now();
  let clientName = "the client";
  if (!expired && link?.client_id) {
    const { data: c } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
    clientName = c?.name ?? clientName;
  }
  return <SalesUploadView token={token} clientName={clientName} valid={!expired} />;
}
