import crypto from "node:crypto";
import { config } from "./config";

/**
 * Keys come from Worker secrets (ENCRYPTION_KEY, SESSION_SECRET). A Worker has no persistent disk, so the old
 * "generate a key file in ./data" fallback is gone: missing keys are a configuration error, reported once.
 * `node:crypto` is provided by the `nodejs_compat` compatibility flag.
 */
export class MissingSecretError extends Error {}

let cachedEnc: Buffer | null = null;
let cachedSig: Buffer | null = null;

function required(value: string | undefined, name: string): string {
  if (!value || value.length < 16) {
    throw new MissingSecretError(`${name} is not set (or shorter than 16 characters). Set it with: npx wrangler secret put ${name}  (local: .dev.vars)`);
  }
  return value;
}

function encKey(): Buffer {
  if (cachedEnc) return cachedEnc;
  cachedEnc = crypto.createHash("sha256").update(`morphie-enc:${required(config.encryptionKey, "ENCRYPTION_KEY")}`).digest();
  return cachedEnc;
}

function sigKey(): Buffer {
  if (cachedSig) return cachedSig;
  cachedSig = crypto.createHash("sha256").update(`morphie-sig:${required(config.sessionSecret, "SESSION_SECRET")}`).digest();
  return cachedSig;
}

/** AES-256-GCM. Output: "v1." + base64url(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1." + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(token: string): string {
  if (!token.startsWith("v1.")) throw new Error("Unrecognised secret format");
  const raw = Buffer.from(token.slice(3), "base64url");
  if (raw.length < 29) throw new Error("Secret is corrupt");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", sigKey()).update(value).digest("base64url").slice(0, 32);
}

export function verifySig(value: string, sig: string): boolean {
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function randomId(bytes = 12): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Test hook: forget cached keys. */
export function _resetCryptoCache(): void {
  cachedEnc = null;
  cachedSig = null;
}
