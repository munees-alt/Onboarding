import { notFound } from "next/navigation";

// Archived (platform cleanup, 2026-07). Weekly Pulse is no longer part of the
// product — kept out of nav and unreachable, but pulse_entries data is untouched
// in case it's needed again.
export default async function PulsePage() {
  notFound();
}
