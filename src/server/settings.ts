import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@/lib/types";
import { config } from "./config";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";

export async function getSettings(userId: string): Promise<AgentSettings> {
  const row = await db().get<{ json: string }>("SELECT json FROM user_settings WHERE user_id = ?", userId);
  let stored: Partial<AgentSettings> = {};
  try { stored = row ? JSON.parse(row.json) : {}; } catch { /* defaults */ }
  return normalizeSettings({ ...DEFAULT_AGENT_SETTINGS, ...stored });
}

export function normalizeSettings(s: Partial<AgentSettings>): AgentSettings {
  const d = DEFAULT_AGENT_SETTINGS;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z_]{1,40}$/.test(x)).slice(0, 40) : []);
  return {
    maxSteps: Math.min(config.maxAgentSteps, Math.max(1, Math.round(Number(s.maxSteps ?? d.maxSteps)) || d.maxSteps)),
    approval: s.approval === "always" || s.approval === "never" ? s.approval : "ask",
    alwaysAllow: list(s.alwaysAllow),
    disabledTools: list(s.disabledTools),
    memory: s.memory !== false,
    temperature: typeof s.temperature === "number" ? Math.min(2, Math.max(0, s.temperature)) : undefined,
  };
}

export async function saveSettings(userId: string, patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const next = normalizeSettings({ ...(await getSettings(userId)), ...patch });
  await db().run(`INSERT INTO user_settings (user_id, json) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET json = excluded.json`, userId, JSON.stringify(next));
  return next;
}

// ------------------------------------------------------------- user secrets

export type SecretName = "tavily";

export async function setSecret(userId: string, name: SecretName, value: string): Promise<void> {
  await db().run(`INSERT INTO user_secrets (user_id, name, value_enc) VALUES (?, ?, ?)
                ON CONFLICT(user_id, name) DO UPDATE SET value_enc = excluded.value_enc`, userId, name, encrypt(value));
}

export async function getSecret(userId: string, name: SecretName): Promise<string | undefined> {
  const row = await db().get<{ value_enc: string }>("SELECT value_enc FROM user_secrets WHERE user_id = ? AND name = ?", userId, name);
  if (!row) return undefined;
  try { return decrypt(row.value_enc); } catch { return undefined; }
}

export async function deleteSecret(userId: string, name: SecretName): Promise<void> {
  await db().run("DELETE FROM user_secrets WHERE user_id = ? AND name = ?", userId, name);
}
