import { notFound } from "next/navigation";

// Archived (platform cleanup, 2026-07). Weekly Client Updates is no longer part
// of the product — kept out of nav and unreachable, but weekly_client_updates
// data is untouched in case it's needed again.
export default async function WeeklyUpdatesPage() {
  notFound();
}
