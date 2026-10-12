import { config } from "../config";
import { verifySig } from "../crypto";
import { readCookie, userExists } from "./session";

/**
 * REMOVE-LEGACY-SHIM (see README, "Removing the legacy cookie shim").
 *
 * Before sessions existed, the browser held `morphie_uid=<id>.<hmac>`: the cookie *was* the identity. For one
 * release we accept a still-valid one and turn it into a normal guest session for the same user row, so nobody's
 * data disappears on upgrade. The old cookie is cleared in the same response.
 */
export const LEGACY_COOKIE = "morphie_uid";

/** The user id carried by a valid legacy cookie that still has a users row, or null. */
export function legacyUserId(req: Request): string | null {
  if (!config.acceptLegacyCookie) return null;
  const raw = readCookie(req, LEGACY_COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !verifySig(id, raw.slice(dot + 1))) return null;
  return userExists(id) ? id : null;
}

export function clearLegacyCookie(): string {
  return `${LEGACY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
