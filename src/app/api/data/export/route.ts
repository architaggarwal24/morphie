import { getConversation, getMessages, listConversations } from "@/server/conversations";
import { getDesign, listDesigns } from "@/server/design/service";
import { route } from "@/server/http";
import { listMemories } from "@/server/memory";
import { listDocuments } from "@/server/rag";
import { listProfiles } from "@/server/profiles";
import { getSettings } from "@/server/settings";
import { readAllFiles } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A portable JSON copy of your data. API keys and header values are never included. */
export const GET = route(async (c) => {
  const convs = await listConversations(c.userId);
  const conversations = [];
  for (const conv of convs) conversations.push({ ...(await getConversation(c.userId, conv.id)), messages: await getMessages(c.userId, conv.id) });
  const designs = [];
  for (const d of await listDesigns(c.userId)) { const s = await getDesign(c.userId, d.id); designs.push({ id: s.id, name: s.name, design: s.design }); }
  const data = {
    exportedAt: new Date().toISOString(),
    settings: await getSettings(c.userId),
    providers: (await listProfiles(c.userId)).profiles.map(({ id, kind, label, model, baseUrl }) => ({ id, kind, label, model, baseUrl })),
    conversations,
    memories: await listMemories(c.userId),
    documents: (await listDocuments(c.userId)).map(({ name, kind, size }) => ({ name, kind, size })),
    designs,
    workspace: await readAllFiles(c.userId),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="morphie-export.json"' } });
});
