import type { Actor } from "../auth/actor";
import { db } from "../db";
import { NotFoundError } from "./errors";

export interface MemoryRow { id: string; content: string; category: string; source: string; created_at: number; updated_at: number }

export function listMemoryRows(actor: Actor): MemoryRow[] {
  return db().prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC").all(actor.userId) as MemoryRow[];
}

export function insertMemory(actor: Actor, row: MemoryRow): void {
  db().prepare("INSERT INTO memories (id, user_id, content, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, actor.userId, row.content, row.category, row.source, row.created_at, row.updated_at);
}

export function deleteMemory(actor: Actor, id: string): void {
  const info = db().prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, actor.userId);
  if (Number(info.changes) !== 1) throw new NotFoundError("Memory not found");
}

export function clearMemories(actor: Actor): void {
  db().prepare("DELETE FROM memories WHERE user_id = ?").run(actor.userId);
}
