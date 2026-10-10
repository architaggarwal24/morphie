import { config } from "@/server/config";
import { listConversations } from "@/server/conversations";
import { route } from "@/server/http";
import { listProfiles } from "@/server/profiles";
import { CUSTOM_PRESETS, publicCatalog } from "@/server/providers/catalog";
import { getSecret, getSettings } from "@/server/settings";
import { toolInfos } from "@/server/tools";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the UI needs on first load, in one round trip. */
export const GET = route(async (c) => {
  const { profiles, activeId } = await listProfiles(c.userId);
  return {
    version: "2.0.0",
    catalog: publicCatalog(),
    customPresets: CUSTOM_PRESETS,
    profiles, activeId,
    settings: await getSettings(c.userId),
    tools: toolInfos(),
    search: { user: !!(await getSecret(c.userId, "tavily")), server: !!config.tavilyKey },
    conversations: await listConversations(c.userId),
    server: { allowPrivateUrls: config.allowPrivateUrls, maxUploadMb: Math.round(config.maxUploadBytes / 1048576), maxAgentSteps: config.maxAgentSteps },
  };
});
