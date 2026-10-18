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
export const GET = route({ auth: "user" }, async (c) => {
  const conversations = listConversations(c.actor).map((conv) => ({ ...getConversation(c.actor, conv.id), messages: getMessages(c.actor, conv.id) }));
  const data = {
    exportedAt: new Date().toISOString(),
    settings: getSettings(c.actor),
    providers: listProfiles(c.actor).profiles.map(({ id, kind, label, model, baseUrl }) => ({ id, kind, label, model, baseUrl })),
    conversations,
    memories: listMemories(c.actor),
    documents: listDocuments(c.actor).map(({ name, kind, size }) => ({ name, kind, size })),
    designs: listDesigns(c.actor).map((d) => getDesign(c.actor, d.id)).map((s) => ({ id: s.id, name: s.name, design: s.design })),
    workspace: listFiles(c.actor).map((f) => ({ path: f.path, content: readFile(c.actor, f.path) })),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="morphie-export.json"' } });
});
