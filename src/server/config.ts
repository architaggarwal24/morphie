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
  /** Local-first default: Ollama / LM Studio live on localhost. Set to false when hosting publicly. */
  get allowPrivateUrls(): boolean {
    return envBool("MORPHIE_ALLOW_PRIVATE_URLS", true);
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

export const LIMITS = {
  message: 20_000,
  maxHistoryMessages: 30,
  toolOutputChars: 12_000,
  maxDocsPerUser: 50,
  maxChunksPerDoc: 800,
  maxMemories: 500,
  maxProfiles: 24,
};
