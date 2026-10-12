import type { Actor } from "../auth/actor";
import { db } from "../db";

/** Agent settings JSON and per-user secrets. Secrets are stored encrypted; callers pass and receive ciphertext. */

export function readSettingsJson(actor: Actor): string | undefined {
  return (db().prepare("SELECT json FROM user_settings WHERE user_id = ?").get(actor.userId) as { json: string } | undefined)?.json;
}

export function writeSettingsJson(actor: Actor, json: string): void {
  db().prepare(`INSERT INTO user_settings (user_id, json) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET json = excluded.json`).run(actor.userId, json);
}

export function readSecretEnc(actor: Actor, name: string): string | undefined {
  return (db().prepare("SELECT value_enc FROM user_secrets WHERE user_id = ? AND name = ?").get(actor.userId, name) as { value_enc: string } | undefined)?.value_enc;
}

export function writeSecretEnc(actor: Actor, name: string, valueEnc: string): void {
  db().prepare(`INSERT INTO user_secrets (user_id, name, value_enc) VALUES (?, ?, ?)
                ON CONFLICT(user_id, name) DO UPDATE SET value_enc = excluded.value_enc`).run(actor.userId, name, valueEnc);
}

export function deleteSecret(actor: Actor, name: string): void {
  db().prepare("DELETE FROM user_secrets WHERE user_id = ? AND name = ?").run(actor.userId, name);
}
