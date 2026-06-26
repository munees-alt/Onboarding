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

  // Guard against a key pasted into the wrong provider field (e.g. an OpenAI
  // `sk-proj-…` key in the Anthropic box). A mismatched key would otherwise fail
  // every Claude call before falling back — slower and noisy. Drop only when the
  // key clearly belongs to a different provider.
  const isAnthropic = (k?: string) => !!k && k.startsWith("sk-ant-");
  const isOpenAi = (k?: string) => !!k && k.startsWith("sk-") && !k.startsWith("sk-ant-");
  if (keys.anthropic && isOpenAi(keys.anthropic)) delete keys.anthropic;
  if (keys.openai && isAnthropic(keys.openai)) delete keys.openai;

  return { keys, models: (data?.feature_models ?? {}) as AiConfig["models"] };
}

function resolveModel(provider: Provider, model: string, apiKey: string) {
  if (provider === "openai") return createOpenAI({ apiKey })(model);
  if (provider === "anthropic") return createAnthropic({ apiKey })(model);
  return createGoogleGenerativeAI({ apiKey })(model);
}

// Usage optimisation: cap output tokens (the main cost driver) and keep
// temperature low for structured/extraction work so the model returns clean
// JSON on the first try (fewer retries). Generous cap on handover_summary —
// it's reused for the deck, contract analysis, COA generation, etc.
const FEATURE_TUNING: Record<AiFeature, { maxOutputTokens: number; temperature: number }> = {
  brief: { maxOutputTokens: 1500, temperature: 0.4 },
  coa: { maxOutputTokens: 2200, temperature: 0.2 },
  coa_suggestions: { maxOutputTokens: 400, temperature: 0.2 },
  agenda: { maxOutputTokens: 900, temperature: 0.4 },
  mom: { maxOutputTokens: 2800, temperature: 0.2 },
  welcome_email: { maxOutputTokens: 900, temperature: 0.4 },
  handover_summary: { maxOutputTokens: 3000, temperature: 0.2 },
};

/**
 * Builds the ordered list of providers to try: the feature's configured provider
 * first (if it has a key), then the remaining available providers in preference
 * order (Anthropic → OpenAI → Google). Only providers with a saved key are kept.
 */
function candidateChain(cfg: AiConfig, feature: AiFeature): FeatureModel[] {
  const order: Provider[] = ["anthropic", "openai", "google"];
  const chain: FeatureModel[] = [];
  const seen = new Set<Provider>();
  const add = (p: Provider, model?: string) => {
    if (seen.has(p) || !cfg.keys[p]) return;
    seen.add(p);
    chain.push({ provider: p, model: model ?? PROVIDER_MODELS[p].models[0] });
  };
  const configured = cfg.models[feature];
  if (configured) add(configured.provider, configured.model);
  order.forEach((p) => add(p));
  return chain;
}

/** Runs an AI feature server-side. Prefers Claude (or the feature's configured provider), falling back to any other connected provider on missing key or error. */
export async function runAi(
  orgId: string,
  feature: AiFeature,
  opts: { system?: string; prompt: string; runId?: string | null },
): Promise<string> {
  const cfg = await getAiConfig(orgId);
  const chain = candidateChain(cfg, feature);
  if (!chain.length) throw new Error("No AI provider key configured. Add one in Settings → AI.");

  const admin = createAdminClient();
  let lastErr: unknown = null;
  for (const fm of chain) {
    const key = cfg.keys[fm.provider]!;
    const tuning = FEATURE_TUNING[feature] ?? { maxOutputTokens: 1500, temperature: 0.3 };
    try {
      const { text, usage } = await generateText({
        model: resolveModel(fm.provider, fm.model, key),
        system: opts.system,
        prompt: opts.prompt,
        maxOutputTokens: tuning.maxOutputTokens,
        temperature: tuning.temperature,
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
      lastErr = e;
      await admin.from("ai_generations").insert({
        org_id: orgId, run_id: opts.runId ?? null, feature,
        provider: fm.provider, model: fm.model, status: "error",
        error: e instanceof Error ? e.message : "unknown",
      });
      // try the next provider in the chain
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All AI providers failed.");
}
