import { randomId } from "../crypto";

export interface Decision { approved: boolean; always?: boolean }

interface Pending { userId: string; resolve: (d: Decision) => void; timer: ReturnType<typeof setTimeout> }

const g = globalThis as unknown as { __morphieApprovals?: Map<string, Pending> };
const pending = (g.__morphieApprovals ??= new Map());

export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/** Suspend the agent until the user answers (or the run is stopped / the prompt times out → denied). */
export function requestApproval(userId: string, signal: AbortSignal, timeoutMs = APPROVAL_TIMEOUT_MS): { id: string; decision: Promise<Decision> } {
  const id = randomId(9);
  const decision = new Promise<Decision>((resolve) => {
    const finish = (d: Decision) => {
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      resolve(d);
    };
    const timer = setTimeout(() => finish({ approved: false }), timeoutMs);
    pending.set(id, { userId, resolve: finish, timer });
    signal.addEventListener("abort", () => finish({ approved: false }), { once: true });
  });
  return { id, decision };
}

/** Called by the approve endpoint. Only the user who owns the run may answer. */
export function decide(userId: string, id: string, decision: Decision): boolean {
  const p = pending.get(id);
  if (!p || p.userId !== userId) return false;
  p.resolve(decision);
  return true;
}

export function pendingCount(): number {
  return pending.size;
}
