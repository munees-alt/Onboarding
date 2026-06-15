// Proves the AI path: decrypt the stored key → AI SDK → OpenAI.
// Run: node --env-file=.env.local scripts/test-ai.mjs
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

function dec(payload) {
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const [iv, tag, ct] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await db.from("ai_settings").select("openai_key_enc").not("openai_key_enc", "is", null).limit(1).single();
const apiKey = dec(data.openai_key_enc);

const { text, usage } = await generateText({
  model: createOpenAI({ apiKey })("gpt-4o-mini"),
  prompt: "In 8 words, what is a UAE retail chart of accounts for?",
});
console.log("AI says:", text);
console.log("tokens:", usage?.totalTokens ?? usage?.inputTokens);
console.log("✓ AI integration works end-to-end.");
