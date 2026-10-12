import { isSecureRequest } from "../security";
import { OAUTH_COOKIE, OAUTH_COOKIE_SECURE } from "./oauth";
import { readCookie, rotateSession, sessionCookie, type ResolvedSession } from "./session";

/**
 * Turn a proven identity into a session. The caller's current session (if any) is replaced by a brand-new token
 * (rotation: a pre-login token, including one an attacker might have planted, stops working). If the caller was a
 * guest, the guest's user id is remembered on the new session so the data can be claimed into the account.
 * The guest's data is NOT merged here and the guest session token dies with the rotation.
 */
export function finishLogin(req: Request, ip: string, current: ResolvedSession | null, userId: string): { cookie: string; guestLinked: boolean } {
  const guest = current?.actor.isGuest && current.actor.userId !== userId ? current.actor.userId : undefined;
  const started = rotateSession(current?.actor.sessionId ?? null, {
    userId, isGuest: false, meta: { ip, userAgent: req.headers.get("user-agent") ?? undefined }, linkedGuestUserId: guest,
  });
  return { cookie: sessionCookie(started.token, started, req), guestLinked: !!guest };
}

// The OAuth `state` lives in a short-lived cookie so only the browser that started the login can finish it.
export function oauthCookie(state: string, req: Request): string {
  const secure = isSecureRequest(req);
  return `${secure ? OAUTH_COOKIE_SECURE : OAUTH_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export function clearOauthCookie(req: Request): string {
  const secure = isSecureRequest(req);
  return `${secure ? OAUTH_COOKIE_SECURE : OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export function readOauthState(req: Request): string | undefined {
  return readCookie(req, isSecureRequest(req) ? OAUTH_COOKIE_SECURE : OAUTH_COOKIE);
}
