import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // Fallback: the handle_new_user trigger only links by email AT SIGNUP. If the
  // user's team_members row was created after they signed up, or their email
  // was edited later, profiles.team_member_id stays null and Senior/TL/Junior
  // can't see anything role-scoped. Two-step fallback that ALSO covers the
  // common case where the org chart row has no email yet:
  //   1) Direct email match (ilike).
  //   2) Local-part of the user's email matched against team_members.full_name
  //      (e.g. "shahil@finanshels.com" → "Shahil"). Only when exactly one
  //      active match exists; we also stamp the team_member's email so the
  //      trigger / next read take the fast path.
  if (!teamMember && user.email) {
    const { data: byEmail } = await supabase
      .from("team_members")
      .select("*")
      .ilike("email", user.email)
      .eq("active", true)
      .maybeSingle<TeamMember>();
    if (byEmail) {
      teamMember = byEmail;
    } else {
      const local = (user.email.split("@")[0] ?? "").trim();
      if (local.length >= 3) {
        const { data: cand } = await supabase
          .from("team_members")
          .select("*")
          .ilike("full_name", `%${local}%`)
          .eq("active", true)
          .limit(2)
          .returns<TeamMember[]>();
        if (cand && cand.length === 1) {
          teamMember = cand[0];
          // Stamp the team_members.email so this match is permanent + so trigger-based
          // linking works for any future logins on the same email.
          await supabase.from("team_members").update({ email: user.email }).eq("id", teamMember.id);
        }
      }
    }
    if (teamMember && profile && !profile.team_member_id) {
      await supabase
        .from("profiles")
        .update({ team_member_id: teamMember.id, role: teamMember.role ?? profile.role })
        .eq("id", user.id);
    }
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

  const realRole = teamMember?.role ?? effectiveProfile.role;

  // "View as" impersonation — master admin only. Reads a server-side cookie to
  // override the session's teamMember so every page/data-fetch sees the
  // impersonated person's scoped view.
  if (realRole === "admin" && effectiveProfile.org_id) {
    try {
      const jar = await cookies();
      const viewAsMemberId = jar.get("cadence_view_as")?.value;
      if (viewAsMemberId) {
        const adminDb = createAdminClient();
        const { data: tm } = await adminDb
          .from("team_members")
          .select("*")
          .eq("id", viewAsMemberId)
          .eq("org_id", effectiveProfile.org_id)
          .maybeSingle<TeamMember>();
        if (tm) {
          return {
            userId: user.id,
            email: user.email ?? null,
            profile: { ...effectiveProfile, role: tm.role, team_member_id: tm.id },
            teamMember: tm,
            org,
            viewingAs: {
              realName: teamMember?.full_name ?? effectiveProfile.full_name ?? "Admin",
              realMemberId: teamMember?.id ?? null,
              realRole: "admin",
            },
          };
        }
      }
    } catch {
      // cookies() unavailable in this context (e.g. API route called from cron) — skip
    }
  }

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
