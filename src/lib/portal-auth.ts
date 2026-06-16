import "server-only";
import crypto from "crypto";

// Portal access is gated by an email one-time code. After a visitor proves they
// control the configured email, we issue an HMAC-signed cookie bound to the
// token. The signing key is the server-only CADENCE_ENCRYPTION_KEY.

export const PORTAL_COOKIE = "cadence_portal";

function key(): string {
  return process.env.CADENCE_ENCRYPTION_KEY ?? "cadence-dev-key";
}

/** HMAC signature proving the server granted access to this token. */
export function signPortalToken(token: string): string {
  return crypto.createHmac("sha256", key()).update(token).digest("hex");
}

/** Cookie value format: "<token>.<sig>". */
export function makePortalCookie(token: string): string {
  return `${token}.${signPortalToken(token)}`;
}

/** True if the cookie value is a valid, untampered grant for this token. */
export function verifyPortalCookie(token: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return false;
  const cookieToken = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (cookieToken !== token) return false;
  const expected = signPortalToken(token);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** sha256 of a 6-digit code (we never store the raw code). */
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(`${key()}:${code}`).digest("hex");
}

export function makeCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Mask an email for display: a***@example.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "your email";
  const [u, d] = email.split("@");
  if (!d) return email;
  const head = u.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, u.length - 1))}@${d}`;
}
