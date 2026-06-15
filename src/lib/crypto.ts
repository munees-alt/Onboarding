import crypto from "crypto";

/**
 * AES-256-GCM encryption for secrets at rest (provider API keys, PMS keys).
 * Key comes from CADENCE_ENCRYPTION_KEY (base64, 32 bytes). Server only.
 */
function getKey(): Buffer {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  if (!raw) throw new Error("CADENCE_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("CADENCE_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  return key;
}

/** Returns "iv:tag:ciphertext", all base64. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivb, tagb, encb] = payload.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivb, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encb, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Show only the last 4 chars of a key for display, e.g. "••••••••3f9a". */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  const last = plain.slice(-4);
  return "••••••••" + last;
}
