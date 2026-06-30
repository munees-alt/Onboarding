import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import type { Me, AccessOverrides, OrgMember } from "@/components/identity-context";
import { getAccessMatrix } from "@/lib/role-access";

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
    viewingAs: s.viewingAs ?? null,
  };
  const matrix = s.profile.org_id ? await getAccessMatrix(s.profile.org_id) : null;
  const accessOverrides: AccessOverrides = matrix?.overrides ?? {};

  // For master admin: fetch the org's team members so the "View as" selector has names.
  let orgMembers: OrgMember[] = [];
  if ((s.viewingAs ? s.viewingAs.realRole : me.role) === "admin" && s.profile.org_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("team_members")
      .select("id,full_name,role,avatar_initials,avatar_color")
      .eq("org_id", s.profile.org_id)
      .eq("active", true)
      .order("sort");
    orgMembers = (data ?? []).map((m) => ({
      id: m.id as string,
      name: m.full_name as string,
      role: m.role as string,
      initials: (m.avatar_initials ?? (m.full_name as string).slice(0, 1).toUpperCase()) as string,
      color: (m.avatar_color ?? "#f97316") as string,
    }));
  }

  return <AppShell me={me} accessOverrides={accessOverrides} orgMembers={orgMembers}>{children}</AppShell>;
}
