import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import type { Me } from "@/components/identity-context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await requireSession();
  const me: Me = {
    role: s.teamMember?.role ?? s.profile.role,
    name: s.teamMember?.full_name ?? s.profile.full_name ?? s.email ?? "User",
    initials:
      s.teamMember?.avatar_initials ??
      (s.profile.full_name ?? s.email ?? "U").slice(0, 1).toUpperCase(),
    color: s.teamMember?.avatar_color ?? "#f97316",
    email: s.email,
    memberId: s.teamMember?.id ?? null,
  };
  return <AppShell me={me}>{children}</AppShell>;
}
