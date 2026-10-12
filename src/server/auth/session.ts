import { config } from "../config";
import { db, now } from "../db";
import { randomId, randomToken, sha256 } from "../crypto";
import { isSecureRequest } from "../security";
import type { Actor } from "./actor";

/**
 * Sessions are opaque: the cookie holds 32 random bytes, the database holds only their SHA-256.
 * A leaked database (or backup) therefore cannot be replayed as cookies.
 */

export const COOKIE_PLAIN = "morphie_session";
export const COOKIE_SECURE = "__Host-morphie_session";
/** last_seen_at / idle expiry are written at most this often per session, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60_000;
const PURGE_AFTER_MS = 7 * 86_400_000;

export interface SessionMeta { ip?: string; userAgent?: string }

export interface StartedSession {
  token: string;
  sessionId: string;
  isGuest: boolean;
  userId: string;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
}

export interface ResolvedSession {
  actor: Actor;
  user: { id: string; email: string | null; displayName: string | null; legacyAnonymous: boolean };
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  linkedGuestUserId: string | null;
}

export function hashToken(token: string): string {
  return sha256(token);
}

function lifetimes(isGuest: boolean): { idle: number; max: number } {
  return isGuest ? { idle: config.guestIdleMs, max: config.guestMaxMs } : { idle: config.userIdleMs, max: config.userMaxMs };
}

function clip(v: string | undefined, n: number): string | null {
  return v ? v.slice(0, n) : null;
}

export function userExists(userId: string): boolean {
  return !!db().prepare("SELECT 1 AS x FROM users WHERE id = ?").get(userId);
}

/** A guest is an ordinary users row with is_guest=1, so everything scoped by user_id keeps working. */
export function createGuestUser(at = now()): string {
  const id = randomId(18);
  db().prepare("INSERT INTO users (id, created_at, is_guest, last_seen_at) VALUES (?, ?, 1, ?)").run(id, at, at);
  return id;
}

export function startSession(userId: string, isGuest: boolean, meta: SessionMeta = {}, at = now(), linkedGuestUserId?: string): StartedSession {
  const token = randomToken();
  const sessionId = hashToken(token);
  const { idle, max } = lifetimes(isGuest);
  const absoluteExpiresAt = at + max;
  const idleExpiresAt = Math.min(at + idle, absoluteExpiresAt);
  db().prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip, user_agent, linked_guest_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, at, at, idleExpiresAt, absoluteExpiresAt, clip(meta.ip, 64), clip(meta.userAgent, 200), linkedGuestUserId ?? null);
  return { token, sessionId, isGuest, userId, absoluteExpiresAt, idleExpiresAt };
}

/** Look a token up. Returns null for unknown, revoked, idle-expired or absolutely-expired sessions. */
export function resolveSession(token: string, at = now()): ResolvedSession | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const d = db();
  const sessionId = hashToken(token);
  const row = d.prepare(
    `SELECT s.id, s.user_id, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, s.revoked_at, s.linked_guest_user_id,
            u.is_guest, u.email, u.display_name, u.legacy_anonymous
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  ).get(sessionId);
  if (!row || row.revoked_at != null || row.idle_expires_at <= at || row.absolute_expires_at <= at) return null;
  const isGuest = row.is_guest === 1;
  let idleExpiresAt = row.idle_expires_at as number;
  if (at - row.last_seen_at >= TOUCH_INTERVAL_MS) {
    idleExpiresAt = Math.min(at + lifetimes(isGuest).idle, row.absolute_expires_at);
    d.prepare("UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?").run(at, idleExpiresAt, sessionId);
    d.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(at, row.user_id);
  }
  return {
    actor: { userId: row.user_id, isGuest, sessionId },
    user: { id: row.user_id, email: row.email ?? null, displayName: row.display_name ?? null, legacyAnonymous: row.legacy_anonymous === 1 },
    idleExpiresAt,
    absoluteExpiresAt: row.absolute_expires_at,
    linkedGuestUserId: row.linked_guest_user_id ?? null,
  };
}

/**
 * Replace a session with a fresh token (login, privilege change). The old token stops working immediately;
 * the old row is kept (revoked) for audit until purged.
 */
export function rotateSession(
  oldSessionId: string | null,
  next: { userId: string; isGuest: boolean; meta?: SessionMeta; linkedGuestUserId?: string },
  at = now(),
): StartedSession {
  const d = db();
  return d.transaction(() => {
    if (oldSessionId) d.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, oldSessionId);
    return startSession(next.userId, next.isGuest, next.meta, at, next.linkedGuestUserId);
  })();
}

export function revokeSession(sessionId: string, at = now()): boolean {
  return Number(db().prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, sessionId).changes) > 0;
}

export function revokeAllSessions(userId: string, at = now()): number {
  return Number(db().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(at, userId).changes);
}

/** Drop long-dead session rows (expired or revoked more than a week ago). Cheap; called opportunistically. */
export function purgeSessions(at = now()): number {
  return Number(db().prepare("DELETE FROM sessions WHERE absolute_expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").run(at - PURGE_AFTER_MS, at - PURGE_AFTER_MS).changes);
}

// ------------------------------------------------------------------ cookies

function parseCookies(req: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) { const k = part.slice(0, i).trim(); if (!out.has(k)) out.set(k, part.slice(i + 1).trim()); }
  }
  return out;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookies(req).get(name);
}

/**
 * Over https only the __Host- cookie is read: the prefix guarantees it was set by this exact origin with Secure,
 * so a sibling subdomain cannot plant a plain-named cookie (session fixation). Over plain http only the plain name.
 */
export function readSessionToken(req: Request): string | undefined {
  return readCookie(req, isSecureRequest(req) ? COOKIE_SECURE : COOKIE_PLAIN);
}

export function sessionCookie(token: string, session: Pick<StartedSession, "isGuest" | "absoluteExpiresAt">, req: Request, at = now()): string {
  const secure = isSecureRequest(req);
  const parts = [`${secure ? COOKIE_SECURE : COOKIE_PLAIN}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  // Guests: a browser-session cookie (no Max-Age). Accounts: persistent, ending when the session absolutely expires.
  if (!session.isGuest) parts.push(`Max-Age=${Math.max(0, Math.floor((session.absoluteExpiresAt - at) / 1000))}`);
  return parts.join("; ");
}

export function clearSessionCookie(req: Request): string {
  const secure = isSecureRequest(req);
  return `${secure ? COOKIE_SECURE : COOKIE_PLAIN}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
