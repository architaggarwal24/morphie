import type { Actor } from "../auth/actor";
import { ApiError } from "../http";
import { activeProfile } from "../profiles";
import { assertProviderHostAllowed, createProvider } from "./factory";
import type { Provider } from "./types";

/** The user's active provider, ready to call — or a clear, actionable error. */
export async function activeProvider(actor: Actor): Promise<Provider> {
  const profile = activeProfile(actor);
  if (!profile) throw new ApiError(400, "Add an AI provider in Settings to get started.", "no_provider");
  await assertProviderHostAllowed(profile);
  return createProvider(profile);
}
