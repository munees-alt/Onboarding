import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getRunDetail } from "@/lib/data/run-detail";
import { getTemplate } from "@/lib/templates-store";
import { RunView } from "./run-view";

export default async function OnboardingRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const supabase = await createClient();
  const session = await getSession();
  const viewer = { id: session?.teamMember?.id ?? null, role: session?.teamMember?.role ?? session?.profile.role ?? "other" };
  const detail = await getRunDetail(supabase, runId, viewer);
  if (!detail) notFound();
  const template = await getTemplate(detail.templateId);
  if (!template) notFound();
  return <RunView detail={detail} template={template} />;
}
