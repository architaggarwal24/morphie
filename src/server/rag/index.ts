import type { DocumentView } from "@/lib/types";
import { LIMITS } from "../config";
import { randomId, sha256 } from "../crypto";
import { db, now } from "../db";
import { checkSignature, DocumentError, loadDocument, SUPPORTED, type Kind } from "./loaders";
import { stem, tokenize, words } from "../text";

export { DocumentError };

const DIM = 256;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const MIN_SCORE = 0.08;

// ---------------------------------------------------------------- chunking

/** Pack whitespace-separated words into ~size-char chunks with trailing overlap; never splits a normal word. */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  size = Math.max(50, size);
  overlap = Math.max(0, Math.min(overlap, size >> 1));
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const add = w.length + (cur.length ? 1 : 0);
    if (cur.length && len + add > size) {
      chunks.push(cur.join(" "));
      const carry: string[] = [];
      let carryLen = 0;
      for (let k = cur.length - 1; k >= 0; k--) {
        const extra = cur[k].length + (carry.length ? 1 : 0);
        if (carryLen + extra > overlap) break;
        carry.unshift(cur[k]);
        carryLen += extra;
      }
      if (carry.length === cur.length || carryLen + add > size) { cur = []; len = 0; }
      else { cur = carry; len = carryLen; }
      continue;
    }
    cur.push(w);
    len += add;
    i++;
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

// -------------------------------------------------------------- embeddings

function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Deterministic signed feature hashing over stemmed words + bigrams. Local, free, offline. */
export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const toks = words(text).map(stem);
  const push = (tok: string, weight: number) => {
    const h = fnv(tok);
    v[h % DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  toks.forEach((w, i) => { push(w, 1); if (i > 0) push(toks[i - 1] + " " + w, 0.5); });
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const toBuf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBuf = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

// --------------------------------------------------------------- documents

interface DocRow { id: string; name: string; kind: string; size: number; chunk_count: number; created_at: number }
const toView = (r: DocRow): DocumentView => ({ id: r.id, name: r.name, kind: r.kind, size: r.size, chunkCount: r.chunk_count, createdAt: r.created_at });

export function listDocuments(userId: string): DocumentView[] {
  return (db().prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC").all(userId) as DocRow[]).map(toView);
}

export function deleteDocument(userId: string, id: string): void {
  const d = db();
  d.prepare("DELETE FROM chunks WHERE document_id = ? AND user_id = ?").run(id, userId);
  d.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
}

export function clearDocuments(userId: string): void {
  db().prepare("DELETE FROM chunks WHERE user_id = ?").run(userId);
  db().prepare("DELETE FROM documents WHERE user_id = ?").run(userId);
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "").slice(0, 100).trim();
}

export async function ingest(userId: string, filename: string, bytes: Uint8Array, maxBytes: number): Promise<{ doc: DocumentView; created: boolean }> {
  const safe = sanitizeFilename(filename);
  const ext = safe.includes(".") ? safe.split(".").pop()!.toLowerCase() : "";
  if (!(SUPPORTED as readonly string[]).includes(ext)) throw new DocumentError(`Unsupported file type ".${ext}". Supported: ${SUPPORTED.join(", ")}.`);
  const kind = ext as Kind;
  if (!bytes.length) throw new DocumentError("The uploaded file is empty.");
  if (bytes.length > maxBytes) throw new DocumentError(`File is too large. The limit is ${Math.round(maxBytes / 1048576)} MB.`);
  checkSignature(kind, bytes);

  const hash = sha256(bytes);
  const d = db();
  const dup = d.prepare("SELECT * FROM documents WHERE user_id = ? AND sha256 = ?").get(userId, hash) as DocRow | undefined;
  if (dup) return { doc: toView(dup), created: false };
  const count = (d.prepare("SELECT COUNT(*) c FROM documents WHERE user_id = ?").get(userId) as { c: number }).c;
  if (count >= LIMITS.maxDocsPerUser) throw new DocumentError(`You can keep up to ${LIMITS.maxDocsPerUser} documents. Delete one first.`);

  const pages = await loadDocument(kind, bytes);
  if (!pages.length) throw new DocumentError("No readable text could be extracted from this file.");
  const pieces = pages.flatMap((p) => chunkText(p.text).map((t) => (p.page ? `[p.${p.page}] ${t}` : t)));
  if (!pieces.length) throw new DocumentError("No text could be extracted from this file.");
  if (pieces.length > LIMITS.maxChunksPerDoc) throw new DocumentError(`This document is too long (${pieces.length} sections; the limit is ${LIMITS.maxChunksPerDoc}).`);

  const id = randomId(9);
  const insert = d.prepare("INSERT INTO chunks (document_id, user_id, idx, text, embedding) VALUES (?, ?, ?, ?, ?)");
  d.transaction(() => {
    d.prepare("INSERT INTO documents (id, user_id, name, kind, size, sha256, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, safe, kind, bytes.length, hash, pieces.length, now());
    pieces.forEach((t, i) => insert.run(id, userId, i, t, toBuf(embed(t))));
  })();
  return { doc: toView(d.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocRow), created: true };
}

// ------------------------------------------------------------------ search

export interface Hit { documentId: string; document: string; text: string; score: number; idx: number }

/** Hybrid retrieval: cosine over hashed embeddings + coverage of the query's keywords. */
export function searchDocuments(userId: string, query: string, opts: { topK?: number; documentIds?: string[] } = {}): Hit[] {
  const q = embed(query);
  const terms = [...tokenize(query)];
  if (!terms.length) return [];
  const ids = opts.documentIds?.filter((x) => /^[A-Za-z0-9_-]+$/.test(x));
  const rows = db().prepare(
    `SELECT c.document_id, c.idx, c.text, c.embedding, d.name FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.user_id = ?${ids?.length ? ` AND c.document_id IN (${ids.map(() => "?").join(",")})` : ""}`,
  ).all(userId, ...(ids ?? [])) as Array<{ document_id: string; idx: number; text: string; embedding: Buffer; name: string }>;
  const hits: Hit[] = [];
  for (const r of rows) {
    const cosine = dot(q, fromBuf(r.embedding));
    const words = tokenize(r.text);
    const coverage = terms.filter((t) => words.has(t)).length / terms.length;
    const score = 0.55 * Math.max(0, cosine) + 0.45 * coverage;
    if (score >= MIN_SCORE && (coverage > 0 || cosine > 0.25)) hits.push({ documentId: r.document_id, document: r.name, text: r.text, score, idx: r.idx });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.topK ?? 5);
}

export function hasDocuments(userId: string): boolean {
  return !!db().prepare("SELECT 1 FROM documents WHERE user_id = ? LIMIT 1").get(userId);
}
