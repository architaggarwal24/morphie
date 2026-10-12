import type { Actor } from "../auth/actor";
import { db } from "../db";
import { NotFoundError } from "./errors";

/** Design projects and their version history. design_versions has no user_id: every access goes through the owning design. */

export interface DesignRow { id: string; user_id: string; name: string; cursor: number; next_version: number; revision: number; created_at: number; updated_at: number }
export interface VersionRow { version: number; json: string; prompt: string; summary: string; created_at: number }

export function getDesignRow(actor: Actor, id: string): DesignRow | undefined {
  return db().prepare("SELECT * FROM designs WHERE id = ? AND user_id = ?").get(id, actor.userId) as DesignRow | undefined;
}

export function listDesignRows(actor: Actor): Array<DesignRow & { n: number }> {
  return db().prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM design_versions v WHERE v.design_id = d.id) AS n
       FROM designs d WHERE d.user_id = ? ORDER BY d.updated_at DESC`,
  ).all(actor.userId) as Array<DesignRow & { n: number }>;
}

export function loadVersionRows(actor: Actor, designId: string): VersionRow[] {
  return db().prepare(
    `SELECT v.version, v.json, v.prompt, v.summary, v.created_at
       FROM design_versions v JOIN designs d ON d.id = v.design_id
      WHERE v.design_id = ? AND d.user_id = ? ORDER BY v.version ASC`,
  ).all(designId, actor.userId) as VersionRow[];
}

export function insertDesign(actor: Actor, d: { id: string; name: string; now: number }): void {
  db().prepare("INSERT INTO designs (id, user_id, name, cursor, next_version, revision, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 0, ?, ?)")
    .run(d.id, actor.userId, d.name, d.now, d.now);
}

/** Add a version (dropping the redo branch and, once full, the oldest) and move the cursor to it, atomically. */
export function pushVersion(
  actor: Actor,
  row: Pick<DesignRow, "id" | "next_version">,
  v: { json: string; prompt: string; summary: string; name: string; keepUpTo: number; historyLimit: number; now: number },
): void {
  const d = db();
  d.transaction(() => {
    if (!d.prepare("SELECT 1 AS x FROM designs WHERE id = ? AND user_id = ?").get(row.id, actor.userId)) throw new NotFoundError("Design not found");
    d.prepare("DELETE FROM design_versions WHERE design_id = ? AND version > ?").run(row.id, v.keepUpTo);
    d.prepare("INSERT INTO design_versions (design_id, version, json, prompt, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.next_version, v.json, v.prompt, v.summary, v.now);
    d.prepare(`DELETE FROM design_versions WHERE design_id = ? AND version <= (
        SELECT version FROM design_versions WHERE design_id = ? ORDER BY version DESC LIMIT 1 OFFSET ?)`).run(row.id, row.id, v.historyLimit);
    const info = d.prepare("UPDATE designs SET cursor = ?, next_version = ?, revision = revision + 1, name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(row.next_version, row.next_version + 1, v.name, v.now, row.id, actor.userId);
    if (Number(info.changes) !== 1) throw new NotFoundError("Design not found");
  })();
}

export function setCursor(actor: Actor, id: string, version: number, now: number): void {
  const info = db().prepare("UPDATE designs SET cursor = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(version, now, id, actor.userId);
  if (Number(info.changes) !== 1) throw new NotFoundError("Design not found");
}

export function deleteDesign(actor: Actor, id: string): void {
  const d = db();
  d.transaction(() => {
    if (!getDesignRow(actor, id)) throw new NotFoundError("Design not found");
    d.prepare("DELETE FROM design_versions WHERE design_id IN (SELECT id FROM designs WHERE id = ? AND user_id = ?)").run(id, actor.userId);
    d.prepare("DELETE FROM designs WHERE id = ? AND user_id = ?").run(id, actor.userId);
  })();
}
