// Validates and stores AI provider keys (encrypted) in ai_settings.
// Keys are passed via env so they're never written to disk here.
// Run: OPENAI_KEY=... GEMINI_KEY=... [ANTHROPIC_KEY=...] node --env-file=.env.local scripts/set-ai-keys.mjs
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function enc(plain) {
  const key = Buffer.from(process.env.CADENCE_ENCRYPTION_KEY, "base64");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const e = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), e.toString("base64")].join(":");
}

const openai = process.env.OPENAI_KEY?.trim();
const gemini = process.env.GEMINI_KEY?.trim();
const anthropic = process.env.ANTHROPIC_KEY?.trim();

// ---- validate (no key printed) ----
if (openai) {
  const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${openai}` } });
  console.log("OpenAI key:", r.ok ? "✓ valid" : `✗ ${r.status}`);
}
if (gemini) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gemini}`);
  console.log("Gemini key:", r.ok ? "✓ valid" : `✗ ${r.status}`);
}
if (anthropic) {
  const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01" } });
  console.log("Anthropic key:", r.ok ? "✓ valid" : `✗ ${r.status}`);
}

// ---- store ----
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await db.from("orgs").select("id").order("created_at").limit(1).single();
const patch = { org_id: org.id };
if (openai) patch.openai_key_enc = enc(openai);
if (gemini) patch.google_key_enc = enc(gemini);
if (anthropic) patch.anthropic_key_enc = enc(anthropic);
const { error } = await db.from("ai_settings").upsert(patch, { onConflict: "org_id" });
console.log(error ? "Store FAILED: " + error.message : "✓ Keys stored (encrypted) in ai_settings.");
