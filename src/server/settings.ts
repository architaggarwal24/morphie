import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@/lib/types";
import { config } from "./config";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";

export function getSettings(userId: string): AgentSettings {
  const row = db().prepare("SELECT json FROM user_settings WHERE user_id = ?").get(userId) as { json: string } | undefined;
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

export function saveSettings(userId: string, patch: Partial<AgentSettings>): AgentSettings {
  const next = normalizeSettings({ ...getSettings(userId), ...patch });
  db().prepare(`INSERT INTO user_settings (user_id, json) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET json = excluded.json`).run(userId, JSON.stringify(next));
  return next;
}

// ------------------------------------------------------------- user secrets

export type SecretName = "tavily";

export function setSecret(userId: string, name: SecretName, value: string): void {
  db().prepare(`INSERT INTO user_secrets (user_id, name, value_enc) VALUES (?, ?, ?)
                ON CONFLICT(user_id, name) DO UPDATE SET value_enc = excluded.value_enc`).run(userId, name, encrypt(value));
}

export function getSecret(userId: string, name: SecretName): string | undefined {
  const row = db().prepare("SELECT value_enc FROM user_secrets WHERE user_id = ? AND name = ?").get(userId, name) as { value_enc: string } | undefined;
  if (!row) return undefined;
  try { return decrypt(row.value_enc); } catch { return undefined; }
}

export function deleteSecret(userId: string, name: SecretName): void {
  db().prepare("DELETE FROM user_secrets WHERE user_id = ? AND name = ?").run(userId, name);
}
