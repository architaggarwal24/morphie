import type { Actor } from "../auth/actor";
import { db } from "../db";
import { NotFoundError } from "./errors";

export interface ProfileRow {
  id: string; user_id: string; kind: string; label: string; model: string;
  secret_enc: string | null; base_url: string | null; options_enc: string | null; updated_at: number;
}

export function listProfileRows(actor: Actor): ProfileRow[] {
  return db().prepare("SELECT * FROM provider_profiles WHERE user_id = ? ORDER BY updated_at DESC").all(actor.userId) as ProfileRow[];
}

export function getProfileRow(actor: Actor, id: string): ProfileRow | undefined {
  return db().prepare("SELECT * FROM provider_profiles WHERE id = ? AND user_id = ?").get(id, actor.userId) as ProfileRow | undefined;
}

export function countProfiles(actor: Actor): number {
  return db().prepare("SELECT COUNT(*) AS c FROM provider_profiles WHERE user_id = ?").get(actor.userId).c as number;
}

export function getActiveProfileId(actor: Actor): string | null {
  return (db().prepare("SELECT active_profile_id FROM user_settings WHERE user_id = ?").get(actor.userId) as { active_profile_id: string | null } | undefined)?.active_profile_id ?? null;
}

export function upsertProfile(actor: Actor, p: Omit<ProfileRow, "user_id" | "updated_at"> & { now: number }): void {
  // The conflict clause is owner-checked too: an id that belongs to someone else can never be overwritten.
  db().prepare(`INSERT INTO provider_profiles (id, user_id, kind, label, model, secret_enc, base_url, options_enc, created_at, updated_at)
                VALUES (@id, @user_id, @kind, @label, @model, @secret_enc, @base_url, @options_enc, @t, @t)
                ON CONFLICT(id) DO UPDATE SET label=@label, model=@model, secret_enc=@secret_enc, base_url=@base_url, options_enc=@options_enc, updated_at=@t
                WHERE provider_profiles.user_id = @user_id`)
    .run({ id: p.id, user_id: actor.userId, kind: p.kind, label: p.label, model: p.model, secret_enc: p.secret_enc, base_url: p.base_url, options_enc: p.options_enc, t: p.now });
}

export function setActiveProfileId(actor: Actor, id: string): void {
  const d = db();
  d.transaction(() => {
    if (!getProfileRow(actor, id)) throw new NotFoundError("Provider not found");
    d.prepare(`INSERT INTO user_settings (user_id, active_profile_id) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET active_profile_id = excluded.active_profile_id`).run(actor.userId, id);
  })();
}

export function deleteProfile(actor: Actor, id: string): void {
  const d = db();
  d.transaction(() => {
    const info = d.prepare("DELETE FROM provider_profiles WHERE id = ? AND user_id = ?").run(id, actor.userId);
    if (Number(info.changes) !== 1) throw new NotFoundError("Provider not found");
    d.prepare("UPDATE user_settings SET active_profile_id = NULL WHERE user_id = ? AND active_profile_id = ?").run(actor.userId, id);
  })();
}
