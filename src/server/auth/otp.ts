import { randomInt } from "node:crypto";
import { hmacHex, randomId, safeEqualHex } from "../crypto";
import { db, now } from "../db";
import { noteSend, sendFailureHint, transport } from "../email";
import { findOrCreateAccount, normalizeEmail, type AccountUser } from "./accounts";

/**
 * Email one-time codes.
 *
 * - 6 digits, valid 10 minutes, single use, at most 5 wrong guesses per code.
 * - Only an HMAC of the code (keyed with a server-side subkey, bound to the email and challenge id) is stored.
 *   A bare SHA-256 of a 6-digit number would be reversible in microseconds if the database leaked.
 * - Sign-in doubles as sign-up: every address gets a code, so a request never reveals whether an account exists.
 *   An account is created only after the code is proven.
 * - A resend cooldown and an hourly cap apply per address (known or not), and the response is identical either way.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
export const isPlausibleEmail = (e: string): boolean => e.length <= 254 && EMAIL_RE.test(e);

const codeHash = (email: string, id: string, code: string) => hmacHex("otp", `${email}|${id}|${code}`);
// Compared against when no challenge exists, so "no such challenge" costs the same as "wrong code".
// Computed on first use, not at import: building the app must not require the production secrets.
let dummy: string | undefined;
const dummyHash = () => (dummy ??= codeHash("nobody@example.invalid", "dummy-challenge", "000000"));

function body(code: string): string {
  return [
    `Your Morphie sign-in code is ${code}.`,
    "",
    "It expires in 10 minutes and works once. Enter it in the browser tab where you asked for it.",
    "If you didn't ask for this, you can ignore this email: nobody can sign in without the code.",
  ].join("\n");
}

/**
 * Ask for a code. ALWAYS looks identical to the caller; whether an email was actually sent depends only on the
 * cooldown and hourly cap for that address, never on whether an account exists.
 */
export function requestCode(rawEmail: string, ip: string, at = now()): void {
  const email = normalizeEmail(rawEmail);
  const d = db();
  const last = d.prepare("SELECT created_at FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1").get(email) as { created_at: number } | undefined;
  if (last && at - last.created_at < RESEND_COOLDOWN_MS) return;
  const recent = d.prepare("SELECT COUNT(*) AS n FROM email_codes WHERE email = ? AND created_at > ?").get(email, at - 3_600_000).n as number;
  if (recent >= MAX_CODES_PER_HOUR) return;

  const id = randomId(12);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  d.transaction(() => {
    // Only the newest code is ever valid, so outstanding codes can't multiply an attacker's guesses.
    d.prepare("UPDATE email_codes SET used_at = ? WHERE email = ? AND used_at IS NULL").run(at, email);
    d.prepare("INSERT INTO email_codes (id, email, code_hash, attempts, created_at, expires_at, ip) VALUES (?, ?, ?, 0, ?, ?, ?)")
      .run(id, email, codeHash(email, id, code), at, at + CODE_TTL_MS, ip.slice(0, 64));
  })();
  // Fire and forget: awaiting the mail server would make "known"/"unknown" or "sent"/"skipped" measurable by timing.
  const t = transport();
  void t.send({ to: email, subject: "Your Morphie sign-in code", text: body(code) }).then(
    () => noteSend(true),
    (e) => {
      noteSend(false);
      console.error(`[auth] couldn't send the sign-in email (${t.name}): ${(e as Error).message}. ${sendFailureHint(t.name)}`.trim());
    },
  );
}

export type VerifyResult = { ok: true; user: AccountUser; created: boolean } | { ok: false };

/** Check a code. Every failure (wrong, expired, used, too many tries, unknown email) is the same `{ ok: false }`. */
export function verifyCode(rawEmail: string, rawCode: string, at = now()): VerifyResult {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  const d = db();
  const row = d.prepare(
    "SELECT id, code_hash, attempts FROM email_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  ).get(email, at) as { id: string; code_hash: string; attempts: number } | undefined;

  const shapeOk = /^\d{6}$/.test(code);
  const expected = row?.code_hash ?? dummyHash();
  const given = codeHash(email, row?.id ?? "dummy-challenge", shapeOk ? code : "000000");
  const match = safeEqualHex(expected, given) && !!row && shapeOk && row.attempts < MAX_ATTEMPTS;

  if (!row) return { ok: false };
  if (!match) {
    d.prepare("UPDATE email_codes SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE used_at END WHERE id = ? AND used_at IS NULL")
      .run(MAX_ATTEMPTS, at, row.id);
    return { ok: false };
  }
  // Single use, atomically: of two simultaneous submissions of the right code, exactly one wins.
  const won = d.prepare("UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND attempts < ? AND expires_at > ?").run(at, row.id, MAX_ATTEMPTS, at);
  if (Number(won.changes) !== 1) return { ok: false };
  const { user, created } = findOrCreateAccount(email);
  return { ok: true, user, created };
}
