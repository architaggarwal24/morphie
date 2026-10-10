/**
 * Pure coordination logic, no Cloudflare imports. It runs inside the `Coordinator` Durable Object in
 * production, and in-process in tests and `next dev` (where Durable Objects aren't available).
 *
 * One instance serves one anonymous user, so every key below is already user-scoped.
 */
export interface Decision { approved: boolean; always?: boolean }

interface Lock { token: string; expires: number }
interface Waiter { ttlMs: number; resolve: (token: string | null) => void; timer: ReturnType<typeof setTimeout> }
interface Pending { promise: Promise<Decision>; resolve: (d: Decision) => void; decided: boolean; timer: ReturnType<typeof setTimeout> }

let counter = 0;
const newToken = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class CoordinatorCore {
  private locks = new Map<string, Lock>();
  private waiters = new Map<string, Waiter[]>();
  private approvals = new Map<string, Pending>();
  private buckets = new Map<string, number[]>();

  // ------------------------------------------------------------------ locks
  // Locks carry a TTL so a crashed/evicted request can never wedge a conversation or design forever.

  private live(key: string): Lock | undefined {
    const l = this.locks.get(key);
    if (l && l.expires <= Date.now()) { this.locks.delete(key); return undefined; }
    return l;
  }

  /** Non-blocking: returns a token, or null if the key is already held. */
  tryAcquire(key: string, ttlMs: number): string | null {
    if (this.live(key)) return null;
    const token = newToken();
    this.locks.set(key, { token, expires: Date.now() + ttlMs });
    return token;
  }

  /** FIFO queue: waits up to `waitMs` for the key. Returns a token, or null on timeout. */
  acquire(key: string, ttlMs: number, waitMs: number): Promise<string | null> {
    const now = this.tryAcquire(key, ttlMs);
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const queue = this.waiters.get(key) ?? [];
      const w: Waiter = {
        ttlMs, resolve,
        timer: setTimeout(() => {
          const q = this.waiters.get(key);
          if (q) { const i = q.indexOf(w); if (i >= 0) q.splice(i, 1); if (!q.length) this.waiters.delete(key); }
          resolve(null);
        }, waitMs),
      };
      queue.push(w);
      this.waiters.set(key, queue);
      // The holder's TTL may lapse without a release(); make sure a waiter notices.
      const held = this.live(key);
      if (held) setTimeout(() => this.drain(key), Math.max(0, held.expires - Date.now()) + 5);
    });
  }

  release(key: string, token: string): void {
    const l = this.locks.get(key);
    if (l && l.token === token) this.locks.delete(key);
    this.drain(key);
  }

  private drain(key: string): void {
    if (this.live(key)) return;
    const q = this.waiters.get(key);
    while (q?.length) {
      const w = q.shift()!;
      clearTimeout(w.timer);
      const token = this.tryAcquire(key, w.ttlMs);
      w.resolve(token);
      if (token) break;
    }
    if (q && !q.length) this.waiters.delete(key);
  }

  // ------------------------------------------------------------- rate limits

  /** Sliding window. Returns seconds to wait, or 0 if the call may proceed. */
  rateLimit(key: string, limit: number, windowMs: number): number {
    const t = Date.now();
    const hits = (this.buckets.get(key) ?? []).filter((h) => t - h < windowMs);
    if (hits.length >= limit) {
      this.buckets.set(key, hits);
      return Math.max(1, Math.ceil((windowMs - (t - hits[0])) / 1000));
    }
    hits.push(t);
    this.buckets.set(key, hits);
    if (this.buckets.size > 200) {
      for (const [k, b] of this.buckets) if (!b.length || t - b[b.length - 1] > 120_000) this.buckets.delete(k);
    }
    return 0;
  }

  // --------------------------------------------------------------- approvals
  // Two steps on purpose: openApproval() registers the request and returns once it exists, and only then is the
  // `approval` event sent to the browser. That guarantees decide() can never arrive before the request is known.

  openApproval(id: string, timeoutMs: number): void {
    let resolve!: (d: Decision) => void;
    const promise = new Promise<Decision>((r) => { resolve = r; });
    const p: Pending = { promise, resolve, decided: false, timer: setTimeout(() => this.settle(id, { approved: false }), timeoutMs) };
    this.approvals.set(id, p);
  }

  /** Resolves when decide() / cancelApproval() is called, or the timeout elapses (→ denied). */
  awaitApproval(id: string): Promise<Decision> {
    return this.approvals.get(id)?.promise ?? Promise.resolve({ approved: false });
  }

  private settle(id: string, d: Decision): boolean {
    const p = this.approvals.get(id);
    if (!p || p.decided) return false;
    p.decided = true;
    clearTimeout(p.timer);
    p.resolve(d);
    // Keep the settled entry briefly so a late awaitApproval() still receives the answer, then forget it.
    setTimeout(() => this.approvals.delete(id), 60_000);
    return true;
  }

  decide(id: string, decision: Decision): boolean {
    return this.settle(id, decision);
  }

  cancelApproval(id: string): void {
    this.settle(id, { approved: false });
  }

  pendingApprovals(): number {
    let n = 0;
    for (const p of this.approvals.values()) if (!p.decided) n++;
    return n;
  }
}
