import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { getTemplate } from "@/lib/templates-store";
import { TemplateEditor } from "./template-editor";

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!canOpenSettings(s.profile.role))
    return <Restricted message="Editing templates is limited to the Master Admin and Ops Head." />;
  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) notFound();
  return <TemplateEditor initial={template} />;
}
