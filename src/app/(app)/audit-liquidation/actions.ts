"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createRunFromTemplate } from "@/lib/runs";

const TEMPLATE_BY_FLOW: Record<string, string> = {
  audit: "audit-workflow",
  liquidation: "liquidation-workflow",
  catchup: "catchup",
};

/** Create a new audit, liquidation or catch-up case (an onboarding_run on the
 *  matching template). Team is assigned inside the case's first stage. AM+ only. */
export async function createAuditLiquidationCase(input: {
  clientId: string;
  flow: "audit" | "liquidation" | "catchup";
}): Promise<{ error?: string; runId?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (!["am", "team_lead", "ops_head", "admin"].includes(role))
    return { error: "Only an AM or above can create a case." };
  const templateId = TEMPLATE_BY_FLOW[input.flow];
  if (!input.clientId || !templateId) return { error: "Pick a client and a case type." };

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  try {
    const runId = await createRunFromTemplate(supabase, {
      orgId: session.profile.org_id,
      clientId: input.clientId,
      amId: session.teamMember?.id ?? null,
      templateId,
      startedAt: today,
    });
    revalidatePath("/audit-liquidation");
    return { runId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create case." };
  }
}
