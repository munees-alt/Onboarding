"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runAi } from "@/lib/ai";

/** AI-generates SOP steps from a plain-language description. */
export async function generateSopSteps(title: string, context: string): Promise<{ error?: string; steps?: string[] }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!title.trim()) return { error: "Give the SOP a title first." };
  try {
    const out = await runAi(session.profile.org_id, "handover_summary", {
      system: "You write clear, numbered standard operating procedures for a UAE accounting firm. Output ONLY a JSON array of step strings.",
      prompt: `Write the steps for this SOP as a JSON array of concise step strings (6-12 steps). Title: "${title}". Context: ${context || "standard best practice"}.`,
    });
    const s = out.indexOf("["), e = out.lastIndexOf("]");
    const steps = s >= 0 ? (JSON.parse(out.slice(s, e + 1)) as string[]) : [];
    return { steps };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed" };
  }
}

export async function saveSop(input: { title: string; industry?: string; steps: string[] }): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.title.trim()) return { error: "Title required." };
  const supabase = await createClient();
  const { error } = await supabase.from("sops").insert({
    org_id: session.profile.org_id, title: input.title.trim(), industry: input.industry?.trim() || null,
    steps: input.steps.filter((s) => s.trim()), created_by_name: session.teamMember?.full_name ?? session.email,
  });
  if (error) return { error: error.message };
  revalidatePath("/sop");
  return {};
}

export async function deleteSop(id: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.from("sops").delete().eq("id", id).eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  revalidatePath("/sop");
  return {};
}
