import { COMPONENTS } from "@/server/design/components";
import { THEMES } from "@/server/design/themes";
import { resolveSession } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { createConversation, addMessageForTest } from "./convHelpers";
import { ingest } from "@/server/rag";
import { addMemory } from "@/server/memory";
import { saveProfile } from "@/server/profiles";
import { writeFile } from "@/server/workspace";
import * as svc from "@/server/design/service";
import { Scripted } from "./scripted";
import type { Client } from "./client";

export type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Resources {
  conversationId: string; designId: string; documentId: string; memoryId: string; profileId: string; workspacePath: string;
}

export const actorOf = (c: Client): Actor => resolveSession(c.sessionToken!)!.actor;

const t = THEMES["modern-saas"];
const design = () => ({
  name: "Victim Co", theme: { ...t.colors }, typography: { ...t.typography }, style: { ...t.style },
  sections: [COMPONENTS.hero.example, COMPONENTS.pricing.example, COMPONENTS.navbar.example, COMPONENTS.footer.example],
});

/** Give a client's actor one of everything that can be addressed by id or path. */
export async function seedResources(c: Client): Promise<Resources> {
  const a = actorOf(c);
  const conv = createConversation(a, "chat", "Victim's private chat");
  addMessageForTest(a, conv.id);
  const state = await svc.handleMessage(a, null, "make a page", new Scripted([{ content: JSON.stringify(design()) }]) as never);
  const doc = await ingest(a, "victim.txt", new TextEncoder().encode("The victim's confidential roadmap says launch in March."), 1_000_000);
  const mem = addMemory(a, "Victim prefers dark mode and works at Initech", "preference", "manual")!;
  const prof = saveProfile(a, { kind: "custom", model: "m", apiKey: "sk-victim-123456789", baseUrl: "http://127.0.0.1:9/v1" });
  writeFile(a, "notes/plan.md", "victim secret");
  return { conversationId: conv.id, designId: state.state.id, documentId: doc.doc.id, memoryId: mem.id, profileId: prof.id, workspacePath: "notes/plan.md" };
}

export interface Case {
  /** Route pattern as discovered from the file path, e.g. /api/design/[id]/[action]. */
  route: string;
  verb: Verb;
  label: string;
  url: (r: Resources) => string;
  params?: (r: Resources) => Record<string, string>;
  body?: (r: Resources) => unknown;
  /** A list endpoint: B gets 200 but must see none of A's data (instead of a 404). */
  listing?: boolean;
  /** What the legitimate owner gets. Default 200. "reaches-handler": anything except 403/404. */
  owner?: number[] | "reaches-handler";
}

const P = (r: Resources) => ({ id: r.designId });
export const CASES: Case[] = [
  { route: "/api/conversations/[id]", verb: "GET", label: "read a conversation", url: (r) => `/api/conversations/${r.conversationId}`, params: (r) => ({ id: r.conversationId }) },
  { route: "/api/conversations/[id]", verb: "PATCH", label: "rename a conversation", url: (r) => `/api/conversations/${r.conversationId}`, params: (r) => ({ id: r.conversationId }), body: () => ({ title: "pwned" }) },
  { route: "/api/conversations/[id]", verb: "DELETE", label: "delete a conversation", url: (r) => `/api/conversations/${r.conversationId}`, params: (r) => ({ id: r.conversationId }) },
  { route: "/api/design/[id]", verb: "GET", label: "read a design", url: (r) => `/api/design/${r.designId}`, params: P },
  { route: "/api/design/[id]", verb: "DELETE", label: "delete a design", url: (r) => `/api/design/${r.designId}`, params: P },
  { route: "/api/design/[id]/[action]", verb: "GET", label: "export a design", url: (r) => `/api/design/${r.designId}/export?format=html`, params: (r) => ({ id: r.designId, action: "export" }) },
  { route: "/api/design/[id]/[action]", verb: "GET", label: "download a design zip", url: (r) => `/api/design/${r.designId}/download?format=html`, params: (r) => ({ id: r.designId, action: "download" }) },
  { route: "/api/design/[id]/[action]", verb: "POST", label: "undo", url: (r) => `/api/design/${r.designId}/undo`, params: (r) => ({ id: r.designId, action: "undo" }), owner: [409] },
  { route: "/api/design/[id]/[action]", verb: "POST", label: "redo", url: (r) => `/api/design/${r.designId}/redo`, params: (r) => ({ id: r.designId, action: "redo" }), owner: [409] },
  { route: "/api/design/[id]/[action]", verb: "POST", label: "restore a version", url: (r) => `/api/design/${r.designId}/restore`, params: (r) => ({ id: r.designId, action: "restore" }), body: () => ({ version: 1 }), owner: [409] },
  { route: "/api/design/[id]/[action]", verb: "POST", label: "rename a design", url: (r) => `/api/design/${r.designId}/rename`, params: (r) => ({ id: r.designId, action: "rename" }), body: () => ({ name: "pwned" }) },
  { route: "/api/design/[id]/[action]", verb: "POST", label: "apply a theme", url: (r) => `/api/design/${r.designId}/theme`, params: (r) => ({ id: r.designId, action: "theme" }), body: () => ({ theme: "modern-saas" }) },
  { route: "/api/documents/[id]", verb: "DELETE", label: "delete a document", url: (r) => `/api/documents/${r.documentId}`, params: (r) => ({ id: r.documentId }) },
  { route: "/api/memory/[id]", verb: "DELETE", label: "delete a memory", url: (r) => `/api/memory/${r.memoryId}`, params: (r) => ({ id: r.memoryId }) },
  { route: "/api/providers/[id]", verb: "DELETE", label: "delete a provider", url: (r) => `/api/providers/${r.profileId}`, params: (r) => ({ id: r.profileId }) },
  { route: "/api/providers/[id]/activate", verb: "POST", label: "activate a provider", url: (r) => `/api/providers/${r.profileId}/activate`, params: (r) => ({ id: r.profileId }) },
  { route: "/api/workspace/file", verb: "GET", label: "read a workspace file", url: (r) => `/api/workspace/file?path=${r.workspacePath}` },
  { route: "/api/workspace/file", verb: "GET", label: "download a workspace file", url: (r) => `/api/workspace/file?path=${r.workspacePath}&download=1` },
  { route: "/api/workspace/file", verb: "DELETE", label: "delete a workspace file", url: (r) => `/api/workspace/file?path=${r.workspacePath}` },
  // list endpoints: scoped to the caller, never to a requested id
  { route: "/api/design", verb: "GET", label: "list designs", url: () => "/api/design", listing: true },
  { route: "/api/providers", verb: "GET", label: "list providers", url: () => "/api/providers", listing: true },
  // id carried in the body
  { route: "/api/chat", verb: "POST", label: "chat into a conversation", url: () => "/api/chat", body: (r) => ({ conversationId: r.conversationId, message: "hello" }), owner: [200] },
  { route: "/api/chat", verb: "POST", label: "truncate a conversation", url: () => "/api/chat", body: (r) => ({ conversationId: r.conversationId, message: "hello", truncateFrom: 1 }), owner: [400] },
  { route: "/api/design", verb: "POST", label: "edit a design", url: () => "/api/design", body: (r) => ({ designId: r.designId, message: "make it blue" }), owner: [200] },
  { route: "/api/providers", verb: "POST", label: "overwrite a provider", url: () => "/api/providers", body: (r) => ({ id: r.profileId, kind: "custom", model: "pwned", baseUrl: "https://attacker.example/v1", apiKey: "sk-attacker-123456789" }) },
  { route: "/api/providers/test", verb: "POST", label: "test with someone's saved key", url: () => "/api/providers/test", body: (r) => ({ profileId: r.profileId, model: "m" }), owner: "reaches-handler" },
  { route: "/api/providers/models", verb: "POST", label: "list models with someone's saved key", url: () => "/api/providers/models", body: (r) => ({ profileId: r.profileId }), owner: "reaches-handler" },
];

/** Routes that mention ids/paths but are deliberately not per-user resources. Each needs a reason. */
export const EXEMPT: Record<string, string> = {
  "/api/agent/approve": "approval ids are single-use, in-memory and keyed by (user, id); a stolen id answers 410 (covered in api.test.ts)",
  "/api/auth/oauth/[provider]/start": "[provider] names a login provider (google|github), not a user-owned resource",
  "/api/auth/oauth/[provider]/callback": "[provider] names a login provider; the callback is bound to the browser by a state cookie (see login.test.ts)",
};

/** Everything A owns, as one comparable value. */
export async function snapshot(a: Actor): Promise<string> {
  const { listConversations, getMessages } = await import("@/server/conversations");
  const { listDocuments } = await import("@/server/rag");
  const { listMemories } = await import("@/server/memory");
  const { listProfiles } = await import("@/server/profiles");
  const { listFiles, readFile } = await import("@/server/workspace");
  const convs = listConversations(a);
  return JSON.stringify({
    convs, messages: convs.map((c) => getMessages(a, c.id)),
    designs: svc.listDesigns(a).map((d) => ({ ...d, state: svc.getDesign(a, d.id).design })),
    docs: listDocuments(a), memories: listMemories(a), profiles: listProfiles(a),
    files: listFiles(a).map((f) => [f.path, readFile(a, f.path)]),
  });
}
