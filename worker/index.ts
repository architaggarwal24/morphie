/**
 * Worker entry point.
 *
 * - `fetch` delegates to the Worker that `opennextjs-cloudflare build` generates (the whole Next.js app).
 * - `Coordinator` is the Durable Object that holds the few things Morphie used to keep in process memory:
 *   pending agent approvals, "this conversation is busy" locks, per-design edit locks and rate limits.
 *   Workers run as many isolates in many places, so those cannot live in a module-level Map any more.
 */
import { DurableObject } from "cloudflare:workers";
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "../.open-next/worker.js";
import { CoordinatorCore, type Decision } from "../src/server/coordinator-core";

export default {
  fetch: handler.fetch,
} satisfies ExportedHandler<CloudflareEnv>;

export class Coordinator extends DurableObject {
  private core = new CoordinatorCore();

  tryAcquire(key: string, ttlMs: number): string | null { return this.core.tryAcquire(key, ttlMs); }
  acquire(key: string, ttlMs: number, waitMs: number): Promise<string | null> { return this.core.acquire(key, ttlMs, waitMs); }
  release(key: string, token: string): void { this.core.release(key, token); }
  rateLimit(key: string, limit: number, windowMs: number): number { return this.core.rateLimit(key, limit, windowMs); }
  openApproval(id: string, timeoutMs: number): void { this.core.openApproval(id, timeoutMs); }
  awaitApproval(id: string): Promise<Decision> { return this.core.awaitApproval(id); }
  decide(id: string, decision: Decision): boolean { return this.core.decide(id, decision); }
  cancelApproval(id: string): void { this.core.cancelApproval(id); }
}
