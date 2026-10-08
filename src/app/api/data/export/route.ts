import { getConversation, getMessages, listConversations } from "@/server/conversations";
import { getDesign, listDesigns } from "@/server/design/service";
import { route } from "@/server/http";
import { listMemories } from "@/server/memory";
import { listDocuments } from "@/server/rag";
import { listProfiles } from "@/server/profiles";
import { getSettings } from "@/server/settings";
import { listFiles, readFile } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A portable JSON copy of your data. API keys and header values are never included. */
export const GET = route(async (c) => {
  const conversations = listConversations(c.userId).map((conv) => ({ ...getConversation(c.userId, conv.id), messages: getMessages(c.userId, conv.id) }));
  const data = {
    exportedAt: new Date().toISOString(),
    settings: getSettings(c.userId),
    providers: listProfiles(c.userId).profiles.map(({ id, kind, label, model, baseUrl }) => ({ id, kind, label, model, baseUrl })),
    conversations,
    memories: listMemories(c.userId),
    documents: listDocuments(c.userId).map(({ name, kind, size }) => ({ name, kind, size })),
    designs: listDesigns(c.userId).map((d) => getDesign(c.userId, d.id)).map((s) => ({ id: s.id, name: s.name, design: s.design })),
    workspace: listFiles(c.userId).map((f) => ({ path: f.path, content: readFile(c.userId, f.path) })),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="morphie-export.json"' } });
});
