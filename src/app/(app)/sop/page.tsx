import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SopLibrary, type SopRow } from "./sop-library";

export default async function SopPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("sops")
    .select("id,title,industry,steps,created_by_name,created_at")
    .order("created_at", { ascending: false });
  return <SopLibrary sops={(data ?? []) as SopRow[]} />;
}
