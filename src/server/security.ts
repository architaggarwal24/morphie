import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config";

export class SecurityError extends Error {}
/** Cross-site request rejected (403). Other SecurityErrors are ordinary input problems (400). */
export class OriginError extends SecurityError {}

// ---------------------------------------------------------------- IP rules

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
];

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return false;
}

function isPrivateName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !net.isIP(h.replace(/^\[|\]$/g, ""));
}

// ------------------------------------------------------------- URL checking

export interface UrlRules {
  /** Permit localhost / private networks (Ollama, LM Studio, LAN gateways). */
  allowPrivate: boolean;
}

/** Validate and normalise a user-supplied base URL. Throws SecurityError with a human message. */
export function validateBaseUrl(raw: string, rules: UrlRules = { allowPrivate: config.allowPrivateUrls }): string {
  const text = (raw ?? "").trim();
  if (!text) throw new SecurityError("Enter a base URL.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SecurityError("That doesn't look like a URL. Include https:// at the start.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SecurityError("The URL must start with https:// or http://.");
  if (url.username || url.password) throw new SecurityError("Don't put credentials in the URL; use the API key field.");
  if (url.hash) throw new SecurityError("Remove the #fragment from the URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(host) ? isPrivateIp(host) : isPrivateName(host);
  if (literal && !rules.allowPrivate) {
    throw new SecurityError("Private and local addresses aren't allowed on this server.");
  }
  if (url.protocol === "http:" && !literal && !rules.allowPrivate) {
    throw new SecurityError("Use https:// for remote providers so your key isn't sent in clear text.");
  }
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/** Resolve DNS and make sure a hostname doesn't point somewhere private. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SecurityError("That address is private.");
    return;
  }
  if (isPrivateName(host)) throw new SecurityError("That host is private.");
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new SecurityError(`Couldn't resolve ${host}.`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new SecurityError("That host resolves to a private address.");
}

// --------------------------------------------------------------- rate limits

interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>();

/** Sliding-window limiter. Returns seconds to wait, or 0 if the call may proceed. */
export function rateLimit(key: string, limit: number, windowMs: number): number {
  const t = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((h) => t - h < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return Math.max(1, Math.ceil((windowMs - (t - bucket.hits[0])) / 1000));
  }
  bucket.hits.push(t);
  buckets.set(key, bucket);
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (!b.hits.length || t - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
  }
  return 0;
}

export function _resetRateLimits(): void {
  buckets.clear();
}

// ------------------------------------------------------------------ CSRF

/** Reject cross-site state-changing requests. */
export function checkOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new OriginError("Bad Origin header.");
    }
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    if (originHost === host || config.allowedOrigins.includes(origin)) return;
    throw new OriginError("Cross-site request blocked.");
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new OriginError("Cross-site request blocked.");
}

// -------------------------------------------------------------- redaction

/** Strip anything that looks like a credential out of text destined for logs or the UI. */
export function redact(text: string, secrets: Array<string | undefined | null> = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(sk|pk|key|tok|gsk|xai|AIza|tvly)[-_][A-Za-z0-9_-]{12,}/g, "[redacted]");
}
