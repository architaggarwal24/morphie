import type { Actor } from "../auth/actor";
import { db } from "../db";
import { NotFoundError } from "./errors";

export interface DocRow { id: string; name: string; kind: string; size: number; sha256: string; chunk_count: number; created_at: number }
export interface ChunkInsert { idx: number; text: string; embedding: Buffer }
export interface ChunkRow { document_id: string; idx: number; text: string; embedding: Buffer; name: string }

export function listDocumentRows(actor: Actor): DocRow[] {
  return db().prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC").all(actor.userId) as DocRow[];
}

export function countDocuments(actor: Actor): number {
  return db().prepare("SELECT COUNT(*) AS c FROM documents WHERE user_id = ?").get(actor.userId).c as number;
}

export function findDocumentByHash(actor: Actor, sha256: string): DocRow | undefined {
  return db().prepare("SELECT * FROM documents WHERE user_id = ? AND sha256 = ?").get(actor.userId, sha256) as DocRow | undefined;
}

export function getDocumentRow(actor: Actor, id: string): DocRow | undefined {
  return db().prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, actor.userId) as DocRow | undefined;
}

/** Document and its chunks are written together or not at all. */
export function insertDocumentWithChunks(actor: Actor, doc: Omit<DocRow, "chunk_count">, chunks: ChunkInsert[]): DocRow {
  const d = db();
  const insert = d.prepare("INSERT INTO chunks (document_id, user_id, idx, text, embedding) VALUES (?, ?, ?, ?, ?)");
  d.transaction(() => {
    d.prepare("INSERT INTO documents (id, user_id, name, kind, size, sha256, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(doc.id, actor.userId, doc.name, doc.kind, doc.size, doc.sha256, chunks.length, doc.created_at);
    for (const c of chunks) insert.run(doc.id, actor.userId, c.idx, c.text, c.embedding);
  })();
  return getDocumentRow(actor, doc.id)!;
}

export function deleteDocument(actor: Actor, id: string): void {
  const d = db();
  d.transaction(() => {
    if (!getDocumentRow(actor, id)) throw new NotFoundError("Document not found");
    d.prepare("DELETE FROM chunks WHERE document_id = ? AND user_id = ?").run(id, actor.userId);
    d.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, actor.userId);
  })();
}

export function clearDocuments(actor: Actor): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM chunks WHERE user_id = ?").run(actor.userId);
    d.prepare("DELETE FROM documents WHERE user_id = ?").run(actor.userId);
  })();
}

export function searchChunkRows(actor: Actor, documentIds?: string[]): ChunkRow[] {
  const ids = documentIds?.length ? documentIds : undefined;
  return db().prepare(
    `SELECT c.document_id, c.idx, c.text, c.embedding, d.name FROM chunks c
       JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
      WHERE c.user_id = ?${ids ? ` AND c.document_id IN (${ids.map(() => "?").join(",")})` : ""}`,
  ).all(actor.userId, ...(ids ?? [])) as ChunkRow[];
}

export function hasDocuments(actor: Actor): boolean {
  return !!db().prepare("SELECT 1 AS x FROM documents WHERE user_id = ? LIMIT 1").get(actor.userId);
}
