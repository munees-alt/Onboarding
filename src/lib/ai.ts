import "server-only";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";
import { PROVIDER_MODELS, type Provider, type AiFeature, type FeatureModel } from "./ai-config";

export interface AiConfig {
  keys: Partial<Record<Provider, string>>;
  models: Partial<Record<AiFeature, FeatureModel>>;
}

export async function getAiConfig(orgId: string): Promise<AiConfig> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_settings")
    .select("openai_key_enc,anthropic_key_enc,google_key_enc,feature_models")
    .eq("org_id", orgId)
    .maybeSingle();

  const keys: Partial<Record<Provider, string>> = {};
  const dec = (v: string | null) => {
    try { return v ? decryptSecret(v) : undefined; } catch { return undefined; }
  };
  if (data?.openai_key_enc) keys.openai = dec(data.openai_key_enc);
  if (data?.anthropic_key_enc) keys.anthropic = dec(data.anthropic_key_enc);
  if (data?.google_key_enc) keys.google = dec(data.google_key_enc);

  return { keys, models: (data?.feature_models ?? {}) as AiConfig["models"] };
}

function resolveModel(provider: Provider, model: string, apiKey: string) {
  if (provider === "openai") return createOpenAI({ apiKey })(model);
  if (provider === "anthropic") return createAnthropic({ apiKey })(model);
  return createGoogleGenerativeAI({ apiKey })(model);
}

function pickDefault(cfg: AiConfig): FeatureModel | null {
  for (const p of ["anthropic", "openai", "google"] as Provider[]) {
    if (cfg.keys[p]) return { provider: p, model: PROVIDER_MODELS[p].models[0] };
  }
  return null;
}

/** Runs an AI feature server-side using the org's configured provider/model. */
export async function runAi(
  orgId: string,
  feature: AiFeature,
  opts: { system?: string; prompt: string; runId?: string | null },
): Promise<string> {
  const cfg = await getAiConfig(orgId);
  const fm = cfg.models[feature] ?? pickDefault(cfg);
  if (!fm) throw new Error("No AI provider key configured. Add one in Settings → AI.");
  const key = cfg.keys[fm.provider];
  if (!key) throw new Error(`No API key set for ${fm.provider}. Add it in Settings → AI.`);

  const admin = createAdminClient();
  try {
    const { text, usage } = await generateText({
      model: resolveModel(fm.provider, fm.model, key),
      system: opts.system,
      prompt: opts.prompt,
    });
    const u = usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    await admin.from("ai_generations").insert({
      org_id: orgId, run_id: opts.runId ?? null, feature,
      provider: fm.provider, model: fm.model,
      prompt_tokens: u?.inputTokens ?? null, completion_tokens: u?.outputTokens ?? null,
      total_tokens: u?.totalTokens ?? null, status: "ok",
    });
    return text;
  } catch (e) {
    await admin.from("ai_generations").insert({
      org_id: orgId, run_id: opts.runId ?? null, feature,
      provider: fm.provider, model: fm.model, status: "error",
      error: e instanceof Error ? e.message : "unknown",
    });
    throw e;
  }
}
