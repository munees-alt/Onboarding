"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { createRunFromTemplate } from "@/lib/runs";
import { createClientDriveFolder } from "@/lib/google";

export interface NewClientInput {
  name: string;
  owner_name?: string;
  industry?: string;
  entity_type?: string;
  services?: string[];
  email?: string;
  phone?: string;
}

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "client"}-${crypto.randomBytes(2).toString("hex")}`;
}

export async function createClientAction(
  input: NewClientInput,
): Promise<{ error?: string; clientId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.name?.trim()) return { error: "Company name is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      org_id: session.profile.org_id,
      name: input.name.trim(),
      owner_name: input.owner_name?.trim() || null,
      industry: input.industry || null,
      entity_type: input.entity_type || null,
      services: input.services ?? [],
      primary_contact_email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      status: "lead",
      profile_complete: false,
      slug: slugify(input.name),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/clients");
  return { clientId: data.id };
}

/** Demo trigger: set client to onboarding and create the run from the chosen template. */
export async function markSignedAction(
  clientId: string,
  templateId: string = "medium-team",
): Promise<{ error?: string; runId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };

  const supabase = await createClient();
  const amId = session.teamMember?.id ?? null;

  // Guard: if a run already exists, just return it.
  const { data: existing } = await supabase
    .from("onboarding_runs")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing) {
    await supabase.from("clients").update({ status: "onboarding" }).eq("id", clientId);
    return { runId: existing.id };
  }

  const { error: ue } = await supabase
    .from("clients")
    .update({ status: "onboarding", am_id: amId })
    .eq("id", clientId);
  if (ue) return { error: ue.message };

  const today = new Date().toISOString().slice(0, 10);
  const target = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);

  try {
    const runId = await createRunFromTemplate(supabase, {
      orgId: session.profile.org_id,
      clientId,
      amId,
      templateId,
      startedAt: today,
      targetCompletion: target,
    });
    const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
    const clientName = client?.name ?? null;
    const drive = amId && clientName ? await createClientDriveFolder(amId, clientName) : null;
    if (!drive) {
      await supabase.from("audit_events").insert({
        org_id: session.profile.org_id,
        actor: session.teamMember?.full_name ?? session.email,
        actor_role: session.profile.role,
        action: "drive_folder_failed",
        module: "onboarding",
        resource_ref: `Drive folder not created for ${clientName ?? "client"}`,
        resource_id: runId,
        resource_type: "run",
        details: { client_id: clientId },
      });
      return {
        error: "Onboarding run was created, but the Drive folder was not. Reconnect Google and confirm you have access to the master Drive folder.",
        runId,
      };
    }
    await supabase.from("drive_folders").upsert(
      { client_id: clientId, tree: { name: clientName, id: drive.id, link: drive.link } },
      { onConflict: "client_id" },
    );
    await supabase.from("audit_events").insert({
      org_id: session.profile.org_id,
      actor: session.teamMember?.full_name ?? session.email,
      actor_role: session.profile.role,
      action: "run_created",
      module: "onboarding",
      resource_ref: "Onboarding run created",
      resource_id: runId,
      resource_type: "run",
      details: drive ? { drive_folder_id: drive.id, drive_link: drive.link } : {},
    });
    revalidatePath("/clients");
    revalidatePath("/onboarding");
    revalidatePath("/my-work");
    return { runId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create run" };
  }
}
