"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canOpenOrgChart } from "@/lib/roles";
import type { Role } from "@/lib/types";

const COLORS = ["#f97316", "#2563eb", "#16a34a", "#7c3aed", "#0d9488", "#d97706", "#dc2626"];
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export interface MemberInput {
  full_name: string;
  email?: string;
  title?: string;
  role: Role;
  dept?: string;
  location?: string;
  reports_to?: string | null;
}

async function guard() {
  const s = await getSession();
  if (!s?.profile.org_id || !canOpenOrgChart(s.profile.role)) return null;
  return s.profile.org_id;
}

export async function createMember(input: MemberInput): Promise<{ error?: string; id?: string }> {
  const orgId = await guard();
  if (!orgId) return { error: "Not allowed." };
  if (!input.full_name?.trim()) return { error: "Name is required." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .insert({
      org_id: orgId,
      full_name: input.full_name.trim(),
      email: input.email?.trim() || null,
      title: input.title?.trim() || null,
      role: input.role,
      dept: input.dept?.trim() || null,
      location: input.location?.trim() || null,
      reports_to: input.reports_to || null,
      avatar_initials: initials(input.full_name),
      avatar_color: COLORS[Math.floor(input.full_name.length) % COLORS.length],
      is_demo: false,
      active: true,
      sort: 500,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/org-chart");
  return { id: data.id };
}

export async function updateMember(id: string, patch: MemberInput): Promise<{ error?: string }> {
  const orgId = await guard();
  if (!orgId) return { error: "Not allowed." };
  if (patch.reports_to === id) return { error: "A person can't report to themselves." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("team_members")
    .update({
      full_name: patch.full_name.trim(),
      email: patch.email?.trim() || null,
      title: patch.title?.trim() || null,
      role: patch.role,
      dept: patch.dept?.trim() || null,
      location: patch.location?.trim() || null,
      reports_to: patch.reports_to || null,
      avatar_initials: initials(patch.full_name),
    })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/org-chart");
  return {};
}

export async function deleteMember(id: string): Promise<{ error?: string }> {
  const orgId = await guard();
  if (!orgId) return { error: "Not allowed." };
  const supabase = await createClient();
  // Re-parent this person's reports to their manager, then delete.
  const { data: node } = await supabase.from("team_members").select("reports_to").eq("id", id).maybeSingle();
  await supabase.from("team_members").update({ reports_to: node?.reports_to ?? null }).eq("reports_to", id);
  const { error } = await supabase.from("team_members").delete().eq("id", id).eq("org_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/org-chart");
  return {};
}
