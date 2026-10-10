import { randomId } from "../crypto";
import { coordinator, type Decision } from "../coordinator";

export type { Decision };

export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * Suspend the agent until the user answers (or the run is stopped / the prompt times out → denied).
 *
 * The chat request that runs the agent and the later "approve" request are separate invocations that may land
 * on different isolates, so the waiting happens inside the user's Coordinator Durable Object: this registers the
 * request there (awaited, so it exists before the browser is told about it) and parks an RPC that the approve
 * endpoint resolves. Because the object is keyed by user id, only the user who owns the run can ever answer it.
 */
export async function requestApproval(userId: string, signal: AbortSignal, timeoutMs = APPROVAL_TIMEOUT_MS): Promise<{ id: string; decision: Promise<Decision> }> {
  const id = randomId(9);
  const stub = coordinator(userId);
  await stub.openApproval(id, timeoutMs);
  const cancel = () => { void stub.cancelApproval(id).catch(() => {}); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const decision = stub.awaitApproval(id).catch((): Decision => ({ approved: false }));
  return { id, decision };
}

/** Called by the approve endpoint. */
export async function decide(userId: string, id: string, decision: Decision): Promise<boolean> {
  return coordinator(userId).decide(id, decision);
}
