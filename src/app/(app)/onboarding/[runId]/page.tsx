import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const detail = await getRunDetail(supabase, runId);
  if (!detail) notFound();
  const template = await getTemplate(detail.templateId);
  if (!template) notFound();
  return <RunView detail={detail} template={template} />;
}
