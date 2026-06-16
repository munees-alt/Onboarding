"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { saveTemplate } from "@/lib/templates-store";
import { runAi } from "@/lib/ai";
import type { OnbTemplate, StepKind, WhoToken } from "@/lib/onboarding-templates";

const VALID_KINDS = ["ai", "person", "link", "doc", "check"];
const VALID_WHO = ["System", "AI", "Client", "Ops", "AM", "Senior", "Junior"];

/** Build a real, editable onboarding template from a plain-text description using the org's AI key. */
export async function createTemplateFromText(text: string): Promise<{ error?: string; id?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!canOpenSettings(session.profile.role)) return { error: "Only the Master Admin or Ops Head can create templates." };
  if (!text.trim() || text.trim().length < 20) return { error: "Describe the onboarding process in a bit more detail first." };

  let out: string;
  try {
    out = await runAi(session.profile.org_id, "brief", {
      system:
        "You design onboarding workflow templates for a UAE accounting firm. Output ONLY valid JSON, no prose. " +
        "Base the stages and steps STRICTLY on the user's description — do not invent client names, dates or placeholder data. " +
        "If the description is thin, produce a sensible structure for what's described, but never fabricate specifics.",
      prompt:
        `Turn this description into an onboarding template. Return ONLY JSON of shape:\n` +
        `{"name":"","teamLabel":"who runs it","desc":"1-2 sentence summary","stages":[{"name":"","desc":"","steps":[{"title":"","kind":"person|ai|link|doc|check","who":["AM"|"Senior"|"Junior"|"Client"|"System"|"AI"|"Ops"]}]}]}\n` +
        `Rules: 3-8 stages; each stage 2-6 steps; "kind": person=someone does it, ai=AI generates, doc=document, link=share a link, check=confirmation; "who" lists roles. Keep titles concrete to the described process.\n\n` +
        `Description:\n${text.slice(0, 6000)}`,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed. Check your AI key in Settings." };
  }

  let parsed: { name?: string; teamLabel?: string; desc?: string; stages?: { name?: string; desc?: string; steps?: { title?: string; kind?: string; who?: string[] }[] }[] };
  try {
    const s = out.indexOf("{"), e = out.lastIndexOf("}");
    parsed = JSON.parse(out.slice(s, e + 1));
  } catch {
    return { error: "The AI returned something we couldn't read. Try rephrasing the description." };
  }
  if (!parsed.stages?.length) return { error: "Couldn't build stages from that. Add more detail about the steps." };

  const slug = (parsed.name ?? "custom").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || "custom";
  const id = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
  const tpl: OnbTemplate = {
    id,
    name: parsed.name?.trim() || "Custom template",
    tier: "Custom",
    teamLabel: parsed.teamLabel?.trim() || "Custom team",
    desc: parsed.desc?.trim() || "Created from a description.",
    color: "blue",
    live: true,
    usedBy: 0,
    stages: parsed.stages.slice(0, 10).map((st, i) => ({
      id: `c${i + 1}`,
      name: st.name?.trim() || `Stage ${i + 1}`,
      desc: st.desc?.trim() || "",
      steps: (st.steps ?? []).slice(0, 8).map((sp, j) => {
        const who = ((sp.who ?? []).filter((w) => VALID_WHO.includes(w)) as WhoToken[]);
        return {
          id: `c${i + 1}.${j + 1}`,
          title: sp.title?.trim() || `Step ${j + 1}`,
          kind: (VALID_KINDS.includes(sp.kind ?? "") ? sp.kind : "person") as StepKind,
          who: who.length ? who : (["AM"] as WhoToken[]),
        };
      }),
    })),
    intake: [],
    uploads: [],
    taskboard: [],
  };

  try {
    await saveTemplate(tpl);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
  revalidatePath("/onboarding");
  return { id };
}

export async function saveTemplateAction(t: OnbTemplate): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session || !canOpenSettings(session.profile.role)) return { error: "Not allowed." };
  if (!t?.id) return { error: "Invalid template." };
  try {
    await saveTemplate(t);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
  revalidatePath("/onboarding");
  revalidatePath(`/templates/${t.id}`);
  return {};
}
