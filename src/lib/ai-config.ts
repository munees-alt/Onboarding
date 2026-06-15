// Client-safe AI config constants + types (no server-only imports).
export type Provider = "openai" | "anthropic" | "google";
export type AiFeature =
  | "brief" | "coa" | "agenda" | "mom" | "welcome_email" | "handover_summary";

export interface FeatureModel { provider: Provider; model: string; }

export const PROVIDER_MODELS: Record<Provider, { label: string; models: string[] }> = {
  openai: { label: "OpenAI (ChatGPT)", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"] },
  anthropic: { label: "Anthropic (Claude)", models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"] },
  google: { label: "Google (Gemini)", models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"] },
};

export const AI_FEATURES: { id: AiFeature; label: string; hint: string }[] = [
  { id: "brief", label: "Pre-call brief", hint: "Business overview, risks, COA recommendation" },
  { id: "coa", label: "COA builder", hint: "Tailor the industry chart of accounts to the client" },
  { id: "agenda", label: "Call agenda", hint: "Kickoff agenda from the brief + intake" },
  { id: "mom", label: "Minutes of meeting", hint: "MoM drafted from the call recording" },
  { id: "welcome_email", label: "Welcome email", hint: "Post-call welcome email draft" },
  { id: "handover_summary", label: "Handover summary", hint: "Handover PDF summary content" },
];
