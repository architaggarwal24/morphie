import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@/lib/types";
import { config } from "./config";
import { decrypt, encrypt } from "./crypto";
import type { Actor } from "./auth/actor";
import * as store from "./data/settings";

export function getSettings(actor: Actor): AgentSettings {
  const json = store.readSettingsJson(actor);
  let stored: Partial<AgentSettings> = {};
  try { stored = json ? JSON.parse(json) : {}; } catch { /* defaults */ }
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

export function saveSettings(actor: Actor, patch: Partial<AgentSettings>): AgentSettings {
  const next = normalizeSettings({ ...getSettings(actor), ...patch });
  store.writeSettingsJson(actor, JSON.stringify(next));
  return next;
}

// ------------------------------------------------------------- user secrets

export type SecretName = "tavily";

/**
 * Secrets are encrypted here, in one place, so that when per-user data keys arrive this is the single hook
 * where values get re-encrypted under the right key.
 */
export function setSecret(actor: Actor, name: SecretName, value: string): void {
  store.writeSecretEnc(actor, name, encrypt(value));
}

export function getSecret(actor: Actor, name: SecretName): string | undefined {
  const enc = store.readSecretEnc(actor, name);
  if (!enc) return undefined;
  try { return decrypt(enc); } catch { return undefined; }
}

export function deleteSecret(actor: Actor, name: SecretName): void {
  store.deleteSecret(actor, name);
}
