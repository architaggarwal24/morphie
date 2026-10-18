import { randomId } from "../crypto";
import { db, now } from "../db";

/**
 * Accounts are created ONLY from an email address that has been proven (a one-time code, or a provider that vouches
 * for it as verified). So a users.email is always verified, and "same verified email" is the only linking rule.
 * An unverified address never creates an account and never links anything.
 */

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export interface AccountUser { id: string; email: string; displayName: string | null }
const toUser = (r: { id: string; email: string; display_name: string | null }): AccountUser => ({ id: r.id, email: r.email, displayName: r.display_name });

export function findUserByEmail(email: string): AccountUser | null {
  const r = db().prepare("SELECT id, email, display_name FROM users WHERE email = ?").get(normalizeEmail(email));
  return r ? toUser(r) : null;
}

function displayNameFor(email: string, name?: string | null): string {
  return (name?.trim() || email.split("@")[0]).slice(0, 60);
}

/** Find the account for a verified email, creating it if this is the first time. Race-safe (unique index on email). */
export function findOrCreateAccount(verifiedEmail: string, name?: string | null): { user: AccountUser; created: boolean } {
  const email = normalizeEmail(verifiedEmail);
  const existing = findUserByEmail(email);
  if (existing) return { user: existing, created: false };
  const id = randomId(18);
  const t = now();
  try {
    db().prepare("INSERT INTO users (id, created_at, email, email_verified_at, display_name, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, t, email, t, displayNameFor(email, name), t);
  } catch (e) {
    const again = findUserByEmail(email); // someone else created it a moment ago
    if (again) return { user: again, created: false };
    throw e;
  }
  return { user: { id, email, displayName: displayNameFor(email, name) }, created: true };
}

export type Provider = "google" | "github";

export interface VerifiedProfile {
  providerUserId: string;
  /** Verified by the provider. Adapters throw rather than return an unverified address. */
  email: string;
  name?: string | null;
}

export interface OAuthLoginResult { user: AccountUser; created: boolean; linked: boolean }

/**
 * 1. A known (provider, provider user id) always wins: it is stable even if the person changes their email.
 * 2. Otherwise the same verified email maps to the same account (and the identity is linked to it).
 * 3. Otherwise a new account is created.
 */
export function loginWithProvider(provider: Provider, profile: VerifiedProfile): OAuthLoginResult {
  const d = db();
  return d.transaction(() => {
    const idRow = d.prepare(
      "SELECT u.id, u.email, u.display_name FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.provider_user_id = ?",
    ).get(provider, profile.providerUserId);
    if (idRow) return { user: toUser(idRow), created: false, linked: false };

    const { user, created } = findOrCreateAccount(profile.email, profile.name);
    d.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(provider, profile.providerUserId, user.id, normalizeEmail(profile.email), now());
    if (!created && !user.displayName && profile.name) d.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(profile.name.slice(0, 60), user.id);
    return { user, created, linked: !created };
  })();
}

export function identitiesOf(userId: string): Array<{ provider: string; email: string }> {
  return db().prepare("SELECT provider, email FROM user_identities WHERE user_id = ? ORDER BY created_at").all(userId);
}
