import { cfEnv } from "./cf";
import { CoordinatorCore, type Decision } from "./coordinator-core";

export type { Decision };

/**
 * Production: one Durable Object per anonymous user (`env.COORDINATOR`), so every isolate that serves that
 * user agrees on approvals, locks and rate limits. Tests and `next dev` (no Durable Object support in the
 * dev proxy) use an in-process CoordinatorCore instead. In a production build a missing binding is a
 * configuration error and we fail loudly rather than silently using per-isolate state.
 */
const g = globalThis as unknown as { __morphieLocal?: Map<string, CoordinatorCore> };

function local(userId: string): CoordinatorStub {
  const map = (g.__morphieLocal ??= new Map());
  let core = map.get(userId);
  if (!core) { core = new CoordinatorCore(); map.set(userId, core); }
  const c = core;
  return {
    tryAcquire: async (k, ttl) => c.tryAcquire(k, ttl),
    acquire: (k, ttl, wait) => c.acquire(k, ttl, wait),
    release: async (k, t) => c.release(k, t),
    rateLimit: async (k, l, w) => c.rateLimit(k, l, w),
    openApproval: async (id, t) => c.openApproval(id, t),
    awaitApproval: (id) => c.awaitApproval(id),
    decide: async (id, d) => c.decide(id, d),
    cancelApproval: async (id) => c.cancelApproval(id),
  };
}

/** Test hook: forget all in-process state. */
export function _resetCoordinator(): void {
  g.__morphieLocal = new Map();
}

export function coordinator(userId: string): CoordinatorStub {
  if (process.env.NODE_ENV === "test") return local(userId);
  let ns: CoordinatorNamespaceLike | undefined;
  try { ns = cfEnv().COORDINATOR; } catch { ns = undefined; }
  if (ns) return ns.get(ns.idFromName(userId));
  if (process.env.NODE_ENV !== "production") return local(userId);
  throw new Error("The COORDINATOR Durable Object binding is missing. Check wrangler.jsonc (durable_objects + exports).");
}

// ---------------------------------------------------------------- helpers

export const LOCK_TTL_MS = 6 * 60_000;

/** Reserve `key` without waiting. Returns a release function, or null if it is already held. */
export async function tryLock(userId: string, key: string, ttlMs = LOCK_TTL_MS): Promise<(() => Promise<void>) | null> {
  const stub = coordinator(userId);
  const token = await stub.tryAcquire(key, ttlMs);
  if (!token) return null;
  return () => stub.release(key, token).catch(() => {});
}

/** Serialise `fn` behind `key` (FIFO, per user). */
export async function withLock<T>(userId: string, key: string, fn: () => Promise<T> | T, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const stub = coordinator(userId);
  const token = await stub.acquire(key, opts.ttlMs ?? LOCK_TTL_MS, opts.waitMs ?? 60_000);
  if (!token) throw new Error("Timed out waiting for another change to finish.");
  try { return await fn(); } finally { await stub.release(key, token).catch(() => {}); }
}
