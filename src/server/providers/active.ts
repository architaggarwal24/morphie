import { ApiError } from "../http";
import { activeProfile } from "../profiles";
import { assertProviderHostAllowed, createProvider } from "./factory";
import type { Provider } from "./types";

/** The user's active provider, ready to call — or a clear, actionable error. */
export async function activeProvider(userId: string): Promise<Provider> {
  const profile = await activeProfile(userId);
  if (!profile) throw new ApiError(400, "Add an AI provider in Settings to get started.", "no_provider");
  await assertProviderHostAllowed(profile);
  return createProvider(profile);
}
