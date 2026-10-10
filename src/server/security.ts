import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config";
import { coordinator } from "./coordinator";

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

/**
 * Resolve a hostname to its addresses. Uses node:dns when the runtime implements it (Node, tests) and falls back to
 * DNS-over-HTTPS (Cloudflare's resolver) where it doesn't, which is the case on Workers.
 */
async function resolveAddresses(host: string): Promise<string[]> {
  try {
    return (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") throw new SecurityError(`Couldn't resolve ${host}.`);
    // node:dns unavailable in this runtime: ask a DoH resolver instead.
  }
  const ask = async (type: "A" | "AAAA"): Promise<string[]> => {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`DoH ${res.status}`);
    const json = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    const want = type === "A" ? 1 : 28;
    return (json.Answer ?? []).filter((r) => r.type === want).map((r) => r.data);
  };
  try {
    const [v4, v6] = await Promise.all([ask("A"), ask("AAAA")]);
    return [...v4, ...v6];
  } catch {
    throw new SecurityError(`Couldn't resolve ${host}.`);
  }
}

/** Resolve DNS and make sure a hostname doesn't point somewhere private. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SecurityError("That address is private.");
    return;
  }
  if (isPrivateName(host)) throw new SecurityError("That host is private.");
  const addrs = await resolveAddresses(host);
  if (!addrs.length) throw new SecurityError(`Couldn't resolve ${host}.`);
  if (addrs.some((a) => isPrivateIp(a))) throw new SecurityError("That host resolves to a private address.");
}

// --------------------------------------------------------------- rate limits

/**
 * Sliding-window limiter, kept in the user's Coordinator Durable Object so every isolate shares one count
 * (an in-memory Map would be per-isolate on Workers). Returns seconds to wait, or 0 if the call may proceed.
 * If the limiter itself is unreachable we fail open rather than take the whole API down.
 */
export async function rateLimit(userId: string, key: string, limit: number, windowMs: number): Promise<number> {
  try {
    return await coordinator(userId).rateLimit(key, limit, windowMs);
  } catch (e) {
    console.error("[rate-limit]", e);
    return 0;
  }
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
