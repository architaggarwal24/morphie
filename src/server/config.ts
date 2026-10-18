import fs from "node:fs";
import path from "node:path";

/**
 * All environment variables are read here and nowhere else. Every one of them
 * is optional: Morphie runs locally with zero configuration.
 */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false (got "${raw}")`);
}

function envInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number >= ${min} (got "${raw}")`);
  return n;
}

export const config = {
  get dataDir(): string {
    // The data dir is chosen at runtime; tell Turbopack not to trace the whole project for this path.
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.MORPHIE_DATA_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  get encryptionKey(): string | undefined {
    return process.env.ENCRYPTION_KEY?.trim() || undefined;
  },
  get sessionSecret(): string | undefined {
    return process.env.SESSION_SECRET?.trim() || undefined;
  },
  get tavilyKey(): string | undefined {
    return process.env.TAVILY_API_KEY?.trim() || undefined;
  },
  /** Local-first default: Ollama / LM Studio live on localhost. In production the default is false. */
  get allowPrivateUrls(): boolean {
    return envBool("MORPHIE_ALLOW_PRIVATE_URLS", process.env.NODE_ENV !== "production");
  },
  /**
   * How many reverse proxies sit in front of the app (0 = none, x-forwarded-* is ignored).
   * "true" means one proxy. The client IP is the Nth entry from the right of x-forwarded-for.
   */
  get trustedProxyHops(): number {
    const raw = process.env.MORPHIE_TRUSTED_PROXY?.trim().toLowerCase();
    if (!raw || ["0", "false", "no", "off"].includes(raw)) return 0;
    if (["true", "yes", "on"].includes(raw)) return 1;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error(`MORPHIE_TRUSTED_PROXY must be false, true or a number of proxies 0-10 (got "${raw}")`);
    return n;
  },
  get ipRatePerMinute(): number {
    return envInt("MORPHIE_IP_RATE_PER_MIN", 600, 1);
  },
  /** Public base URL (https in production). Used for OAuth redirect URIs. */
  get publicUrl(): string | undefined {
    const raw = process.env.MORPHIE_PUBLIC_URL?.trim();
    return raw ? raw.replace(/\/+$/, "") : undefined;
  },
  // ---- sessions
  get userIdleMs(): number { return envInt("MORPHIE_SESSION_IDLE_DAYS", 14, 1) * 86_400_000; },
  get userMaxMs(): number { return envInt("MORPHIE_SESSION_MAX_DAYS", 30, 1) * 86_400_000; },
  // ---- email login
  get emailTransport(): string | undefined { return process.env.MORPHIE_EMAIL_TRANSPORT?.trim().toLowerCase() || undefined; },
  get emailFrom(): string { return process.env.MORPHIE_EMAIL_FROM?.trim() || "Morphie <no-reply@localhost>"; },
  get smtpUrl(): string | undefined { return process.env.MORPHIE_SMTP_URL?.trim() || undefined; },
  get resendKey(): string | undefined { return process.env.RESEND_API_KEY?.trim() || undefined; },
  // ---- OAuth
  get googleClient(): { id: string; secret: string } | undefined {
    const id = process.env.GOOGLE_CLIENT_ID?.trim(); const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    return id && secret ? { id, secret } : undefined;
  },
  get githubClient(): { id: string; secret: string } | undefined {
    const id = process.env.GITHUB_CLIENT_ID?.trim(); const secret = process.env.GITHUB_CLIENT_SECRET?.trim();
    return id && secret ? { id, secret } : undefined;
  },
  get allowedOrigins(): string[] {
    return (process.env.MORPHIE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get maxUploadBytes(): number {
    return envInt("MORPHIE_MAX_UPLOAD_MB", 10, 1) * 1024 * 1024;
  },
  get maxAgentSteps(): number {
    return envInt("MORPHIE_MAX_AGENT_STEPS", 30, 1);
  },
  get ollamaUrl(): string {
    return process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
};

/**
 * Refuse to start in production with unsafe configuration. Returns every problem at once.
 * Called from src/instrumentation.ts at server start and again (cheaply) when secrets are first used.
 */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const enc = env.ENCRYPTION_KEY?.trim();
  const sig = env.SESSION_SECRET?.trim();
  if (!enc) problems.push("ENCRYPTION_KEY is required in production.");
  else if (enc.length < 32) problems.push("ENCRYPTION_KEY must be at least 32 characters (try: openssl rand -base64 48).");
  if (!sig) problems.push("SESSION_SECRET is required in production.");
  else if (sig.length < 32) problems.push("SESSION_SECRET must be at least 32 characters (try: openssl rand -base64 48).");
  if (enc && sig && enc === sig) problems.push("ENCRYPTION_KEY and SESSION_SECRET must be different values.");
  const transport = env.MORPHIE_EMAIL_TRANSPORT?.trim().toLowerCase();
  if (transport === "console" || transport === "memory") problems.push(`MORPHIE_EMAIL_TRANSPORT=${transport} is not allowed in production (use smtp or resend).`);
  if (transport === "smtp" && !env.MORPHIE_SMTP_URL?.trim()) problems.push("MORPHIE_EMAIL_TRANSPORT=smtp needs MORPHIE_SMTP_URL.");
  if (transport === "resend" && !env.RESEND_API_KEY?.trim()) problems.push("MORPHIE_EMAIL_TRANSPORT=resend needs RESEND_API_KEY.");
  const oauth = [env.GOOGLE_CLIENT_ID, env.GITHUB_CLIENT_ID].some((v) => v?.trim());
  const publicUrl = env.MORPHIE_PUBLIC_URL?.trim();
  if ((oauth || transport) && !publicUrl) problems.push("MORPHIE_PUBLIC_URL is required in production when login methods are configured.");
  if (publicUrl && !/^https:\/\//i.test(publicUrl)) problems.push("MORPHIE_PUBLIC_URL must start with https:// in production.");
  return problems;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = productionConfigProblems(env);
  if (problems.length) throw new Error(`Morphie refuses to start with this configuration:\n - ${problems.join("\n - ")}`);
}

export const LIMITS = {
  message: 20_000,
  maxHistoryMessages: 30,
  toolOutputChars: 12_000,
  maxDocsPerUser: 50,
  maxChunksPerDoc: 800,
  maxMemories: 500,
  maxProfiles: 24,
};
