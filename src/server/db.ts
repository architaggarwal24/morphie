import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "./config";
import { migrate } from "./migrations";

/**
 * SQLite via Node's built-in `node:sqlite` (Node >= 22.13): no native module to compile, nothing to install.
 * This thin wrapper adds the two conveniences the rest of the code relies on: pragma() and transaction().
 */
/** Statement surface we use. Rows are untyped here; each store casts to its own row shape. */
export interface Stmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export class DB {
  constructor(private conn: DatabaseSync) {}
  prepare(sql: string): Stmt { return this.conn.prepare(sql) as unknown as Stmt; }
  exec(sql: string): void { this.conn.exec(sql); }
  pragma(statement: string): void { this.conn.exec(`PRAGMA ${statement}`); }
  close(): void { this.conn.close(); }
  /** Returns a function that runs `fn` atomically (BEGIN IMMEDIATE … COMMIT, ROLLBACK on error). */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.conn.exec("BEGIN IMMEDIATE");
      try {
        const out = fn();
        this.conn.exec("COMMIT");
        return out;
      } catch (e) {
        try { this.conn.exec("ROLLBACK"); } catch { /* already rolled back */ }
        throw e;
      }
    };
  }
}

export const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  model TEXT NOT NULL,
  secret_enc TEXT,
  base_url TEXT,
  options_enc TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON provider_profiles(user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  active_profile_id TEXT,
  json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  PRIMARY KEY (user_id, name)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_user ON memories(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);

CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  next_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_designs_user ON designs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS design_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dv_design ON design_versions(design_id, version);
`;

const g = globalThis as unknown as { __morphieDb?: DB; __morphieDbPath?: string };

/** One connection per process (kept across Next.js hot reloads). */
export function db(): DB {
  const file = path.join(config.dataDir, "morphie.db");
  if (g.__morphieDb && g.__morphieDbPath === file) return g.__morphieDb;
  g.__morphieDb?.close();
  const conn = new DB(new DatabaseSync(file));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  conn.exec(BASE_SCHEMA);
  migrate(conn);
  g.__morphieDb = conn;
  g.__morphieDbPath = file;
  return conn;
}

export function now(): number {
  return Date.now();
}
