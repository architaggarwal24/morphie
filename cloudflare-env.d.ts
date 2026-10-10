/**
 * Hand-written binding types (equivalent to `npm run cf-typegen`, which regenerates the full runtime
 * types into this same file name if you prefer). Kept structural so `tsc` needs no Workers type package.
 */
interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>;
}
interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}
interface CoordinatorStub {
  tryAcquire(key: string, ttlMs: number): Promise<string | null>;
  acquire(key: string, ttlMs: number, waitMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
  rateLimit(key: string, limit: number, windowMs: number): Promise<number>;
  openApproval(id: string, timeoutMs: number): Promise<void>;
  awaitApproval(id: string): Promise<{ approved: boolean; always?: boolean }>;
  decide(id: string, decision: { approved: boolean; always?: boolean }): Promise<boolean>;
  cancelApproval(id: string): Promise<void>;
}
interface CoordinatorNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): CoordinatorStub;
}

interface CloudflareEnv {
  /** D1 database (all relational data). */
  DB: D1DatabaseLike;
  /** Durable Object namespace: approvals, locks and rate limits (one object per anonymous user). */
  COORDINATOR: CoordinatorNamespaceLike;
  /** Static assets binding created by OpenNext. */
  ASSETS: { fetch(req: Request): Promise<Response> };

  // Secrets (wrangler secret put …)
  ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  TAVILY_API_KEY?: string;

  // Plain vars (wrangler.jsonc "vars")
  MORPHIE_ALLOW_PRIVATE_URLS?: string;
  MORPHIE_ALLOWED_ORIGINS?: string;
  MORPHIE_MAX_UPLOAD_MB?: string;
  MORPHIE_MAX_AGENT_STEPS?: string;
}
