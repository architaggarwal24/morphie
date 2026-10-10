import { cfEnv } from "./cf";

/**
 * Data access for Cloudflare D1.
 *
 * D1 is asynchronous, so every store module awaits this small wrapper. The same interface is implemented
 * on top of `node:sqlite` in tests/helpers/sqliteDb.ts, which is how the test-suite runs without a Workers
 * runtime. The schema lives in migrations/*.sql (applied with `wrangler d1 migrations apply`).
 */
export interface RunInfo { changes: number; lastRowId: number }
export interface StmtSpec { sql: string; params: unknown[] }

export interface Db {
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunInfo>;
  /** Run several statements atomically (one implicit transaction). */
  batch(stmts: StmtSpec[]): Promise<void>;
}

/** Build a statement for `db().batch([...])`. */
export const stmt = (sql: string, ...params: unknown[]): StmtSpec => ({ sql, params });

/** D1 rejects `undefined` and booleans; normalise once here. */
function clean(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

class D1Db implements Db {
  constructor(private d1: D1DatabaseLike) {}
  private bound(sql: string, params: unknown[]) { return this.d1.prepare(sql).bind(...clean(params)); }
  async get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return ((await this.bound(sql, params).first<T>()) ?? undefined) as T | undefined;
  }
  async all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
    return (await this.bound(sql, params).all<T>()).results ?? [];
  }
  async run(sql: string, ...params: unknown[]): Promise<RunInfo> {
    const { meta } = await this.bound(sql, params).run();
    return { changes: Number(meta?.changes ?? 0), lastRowId: Number(meta?.last_row_id ?? 0) };
  }
  async batch(stmts: StmtSpec[]): Promise<void> {
    if (!stmts.length) return;
    await this.d1.batch(stmts.map((s) => this.bound(s.sql, s.params)));
  }
}

const g = globalThis as unknown as { __morphieDbOverride?: Db | null };

/** Test hook: use another Db implementation (the node:sqlite adapter). Pass null to restore D1. */
export function setDb(override: Db | null): void {
  g.__morphieDbOverride = override;
}

export function db(): Db {
  if (g.__morphieDbOverride) return g.__morphieDbOverride;
  const binding = cfEnv().DB;
  if (!binding) throw new Error("The D1 binding `DB` is missing. Check d1_databases in wrangler.jsonc.");
  return new D1Db(binding);
}

export function now(): number {
  return Date.now();
}

/** Ensure a user row exists (called once per request). */
export async function touchUser(userId: string): Promise<void> {
  await db().run("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)", userId, now());
}

/** Delete every trace of a user (D1 side). Used by "Delete all my data". */
export async function wipeUser(userId: string): Promise<void> {
  await db().batch([
    stmt("DELETE FROM design_versions WHERE design_id IN (SELECT id FROM designs WHERE user_id = ?)", userId),
    stmt("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)", userId),
    ...["designs", "conversations", "chunks", "documents", "memories", "user_secrets", "user_settings", "provider_profiles", "workspace_files"]
      .map((table) => stmt(`DELETE FROM ${table} WHERE user_id = ?`, userId)),
  ]);
}
