import type { Actor } from "../auth/actor";
import { db } from "../db";

/** Content tables that hold a user_id column. Keep in sync with the schema; the wipe test fails if one is missed. */
export const USER_CONTENT_TABLES = [
  "designs", "conversations", "chunks", "documents", "memories", "user_secrets", "user_settings", "provider_profiles",
] as const;

/** Delete every piece of this user's content ("Delete all my data"). The account and its sessions are untouched. */
export function wipeContent(actor: Actor): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM design_versions WHERE design_id IN (SELECT id FROM designs WHERE user_id = ?)").run(actor.userId);
    d.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)").run(actor.userId);
    for (const table of USER_CONTENT_TABLES) d.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(actor.userId);
  })();
}
