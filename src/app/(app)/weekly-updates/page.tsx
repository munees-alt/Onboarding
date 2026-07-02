import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { listWeeklyUpdates } from "./actions";
import { WeeklyUpdatesView } from "./weekly-updates-view";

export default async function WeeklyUpdatesPage() {
  const s = await requireSession();
  const role = s.teamMember?.role ?? s.profile?.role ?? "";
  if (!isMasterAdmin(role)) notFound();
  if (!s.profile?.org_id) notFound();
  const { rows = [], error } = await listWeeklyUpdates();
  return <WeeklyUpdatesView rows={rows} loadError={error ?? null} />;
}
