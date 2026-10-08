import type { AssistantMeta, ConversationView, MessageView, Mode } from "@/lib/types";
import { randomId } from "./crypto";
import { db, now } from "./db";

interface ConvRow { id: string; title: string; mode: string; pinned: number; created_at: number; updated_at: number }
interface MsgRow { id: number; role: string; content: string; meta: string | null; created_at: number }

const toView = (r: ConvRow): ConversationView => ({
  id: r.id, title: r.title, mode: r.mode === "agent" ? "agent" : "chat", pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function listConversations(userId: string, q?: string): ConversationView[] {
  const like = q?.trim() ? `%${q.trim().replace(/[%_]/g, "")}%` : null;
  const rows = like
    ? db().prepare(`SELECT c.* FROM conversations c WHERE c.user_id = ? AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?))
                    ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`).all(userId, like, like)
    : db().prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 200").all(userId);
  return (rows as ConvRow[]).map(toView);
}

export function getConversation(userId: string, id: string): ConversationView | null {
  const r = db().prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as ConvRow | undefined;
  return r ? toView(r) : null;
}

export function createConversation(userId: string, mode: Mode, title = "New conversation"): ConversationView {
  const id = randomId(9);
  const t = now();
  db().prepare("INSERT INTO conversations (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, title, mode, t, t);
  return getConversation(userId, id)!;
}

export function updateConversation(userId: string, id: string, patch: { title?: string; pinned?: boolean }): ConversationView | null {
  const cur = getConversation(userId, id);
  if (!cur) return null;
  db().prepare("UPDATE conversations SET title = ?, pinned = ? WHERE id = ? AND user_id = ?")
    .run((patch.title ?? cur.title).slice(0, 120), (patch.pinned ?? cur.pinned) ? 1 : 0, id, userId);
  return getConversation(userId, id);
}

export function deleteConversation(userId: string, id: string): void {
  if (!getConversation(userId, id)) return;
  db().prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
}

export function getMessages(userId: string, conversationId: string, limit = 500): MessageView[] {
  if (!getConversation(userId, conversationId)) return [];
  const rows = db().prepare("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(conversationId, limit) as MsgRow[];
  return rows.map((r) => ({
    id: r.id, role: r.role === "assistant" ? "assistant" : "user", content: r.content, createdAt: r.created_at,
    meta: r.meta ? safeParse(r.meta) : undefined,
  }));
}

export function addMessage(conversationId: string, role: "user" | "assistant", content: string, meta?: AssistantMeta): number {
  const t = now();
  const info = db().prepare("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(conversationId, role, content, meta ? JSON.stringify(meta) : null, t);
  db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);
  return Number(info.lastInsertRowid);
}

export function deleteMessagesFrom(userId: string, conversationId: string, messageId: number): void {
  if (!getConversation(userId, conversationId)) return;
  db().prepare("DELETE FROM messages WHERE conversation_id = ? AND id >= ?").run(conversationId, messageId);
}

function safeParse(s: string): AssistantMeta | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 48 ? t || "New conversation" : t.slice(0, 47).replace(/\s+\S*$/, "") + "…";
}

export function updateMessageMeta(messageId: number, meta: AssistantMeta): void {
  db().prepare("UPDATE messages SET meta = ? WHERE id = ?").run(JSON.stringify(meta), messageId);
}

export function setTitle(id: string, title: string): void {
  db().prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title.slice(0, 120), id);
}
