import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { getWeeklyUpdate } from "../actions";
import { DraftEditor } from "./draft-editor";

// Next.js 16: params is a Promise in route handlers/pages.
export default async function WeeklyUpdateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const role = s.teamMember?.role ?? s.profile?.role ?? "";
  if (!isMasterAdmin(role)) notFound();
  const { id } = await params;
  const { row, error } = await getWeeklyUpdate(id);
  if (error || !row) notFound();
  return <DraftEditor row={row} />;
}
