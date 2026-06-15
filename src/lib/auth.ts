import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionInfo, Profile, TeamMember, Org } from "./types";

/** Returns the signed-in user's session (profile + team member + org), or null. */
export async function getSession(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  let teamMember: TeamMember | null = null;
  if (profile?.team_member_id) {
    const { data } = await supabase
      .from("team_members")
      .select("*")
      .eq("id", profile.team_member_id)
      .maybeSingle<TeamMember>();
    teamMember = data ?? null;
  }

  let org: Org | null = null;
  if (profile?.org_id) {
    const { data } = await supabase
      .from("orgs")
      .select("id,name")
      .eq("id", profile.org_id)
      .maybeSingle<Org>();
    org = data ?? null;
  }

  const effectiveProfile: Profile =
    profile ??
    ({
      id: user.id,
      org_id: org?.id ?? null,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name as string) ?? user.email ?? null,
      team_member_id: null,
      role: "junior",
    } satisfies Profile);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: effectiveProfile,
    teamMember,
    org,
  };
}

/** Like getSession but redirects to /login when there is no session. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
