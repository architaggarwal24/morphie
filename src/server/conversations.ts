import type { AssistantMeta, ConversationView, MessageView, Mode } from "@/lib/types";
import { randomId } from "./crypto";
import { db, now, stmt } from "./db";

interface ConvRow { id: string; title: string; mode: string; pinned: number; created_at: number; updated_at: number }
interface MsgRow { id: number; role: string; content: string; meta: string | null; created_at: number }

const toView = (r: ConvRow): ConversationView => ({
  id: r.id, title: r.title, mode: r.mode === "agent" ? "agent" : "chat", pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listConversations(userId: string, q?: string): Promise<ConversationView[]> {
  const like = q?.trim() ? `%${q.trim().replace(/[%_]/g, "")}%` : null;
  const rows = like
    ? await db().all<ConvRow>(`SELECT c.* FROM conversations c WHERE c.user_id = ? AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?))
                    ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`, userId, like, like)
    : await db().all<ConvRow>("SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 200", userId);
  return rows.map(toView);
}

export async function getConversation(userId: string, id: string): Promise<ConversationView | null> {
  const r = await db().get<ConvRow>("SELECT * FROM conversations WHERE id = ? AND user_id = ?", id, userId);
  return r ? toView(r) : null;
}

export async function createConversation(userId: string, mode: Mode, title = "New conversation"): Promise<ConversationView> {
  const id = randomId(9);
  const t = now();
  await db().run("INSERT INTO conversations (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, title, mode, t, t);
  return (await getConversation(userId, id))!;
}

export async function updateConversation(userId: string, id: string, patch: { title?: string; pinned?: boolean }): Promise<ConversationView | null> {
  const cur = await getConversation(userId, id);
  if (!cur) return null;
  await db().run("UPDATE conversations SET title = ?, pinned = ? WHERE id = ? AND user_id = ?",
    (patch.title ?? cur.title).slice(0, 120), (patch.pinned ?? cur.pinned) ? 1 : 0, id, userId);
  return getConversation(userId, id);
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  if (!(await getConversation(userId, id))) return;
  await db().batch([
    stmt("DELETE FROM messages WHERE conversation_id = ?", id),
    stmt("DELETE FROM conversations WHERE id = ? AND user_id = ?", id, userId),
  ]);
}

export async function getMessages(userId: string, conversationId: string, limit = 500): Promise<MessageView[]> {
  if (!(await getConversation(userId, conversationId))) return [];
  const rows = await db().all<MsgRow>("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC", conversationId, limit);
  return rows.map((r) => ({
    id: r.id, role: r.role === "assistant" ? "assistant" : "user", content: r.content, createdAt: r.created_at,
    meta: r.meta ? safeParse(r.meta) : undefined,
  }));
}

export async function addMessage(conversationId: string, role: "user" | "assistant", content: string, meta?: AssistantMeta): Promise<number> {
  const t = now();
  const info = await db().run("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)",
    conversationId, role, content, meta ? JSON.stringify(meta) : null, t);
  await db().run("UPDATE conversations SET updated_at = ? WHERE id = ?", t, conversationId);
  return info.lastRowId;
}

export async function deleteMessagesFrom(userId: string, conversationId: string, messageId: number): Promise<void> {
  if (!(await getConversation(userId, conversationId))) return;
  await db().run("DELETE FROM messages WHERE conversation_id = ? AND id >= ?", conversationId, messageId);
}

function safeParse(s: string): AssistantMeta | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 48 ? t || "New conversation" : t.slice(0, 47).replace(/\s+\S*$/, "") + "…";
}

export async function updateMessageMeta(messageId: number, meta: AssistantMeta): Promise<void> {
  await db().run("UPDATE messages SET meta = ? WHERE id = ?", JSON.stringify(meta), messageId);
}

export async function setTitle(id: string, title: string): Promise<void> {
  await db().run("UPDATE conversations SET title = ? WHERE id = ?", title.slice(0, 120), id);
}
