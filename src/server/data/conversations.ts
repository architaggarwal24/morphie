import type { AssistantMeta, ConversationView, MessageView, Mode } from "@/lib/types";
import type { Actor } from "../auth/actor";
import { randomId } from "../crypto";
import { db, now } from "../db";
import { NotFoundError } from "./errors";

/**
 * Conversations and messages. Messages carry no user_id of their own, so every message query joins through the
 * parent conversation and its owner: possession of a conversation or message id proves nothing.
 */

interface ConvRow { id: string; title: string; mode: string; pinned: number; created_at: number; updated_at: number }
interface MsgRow { id: number; role: string; content: string; meta: string | null; created_at: number }

const toView = (r: ConvRow): ConversationView => ({
  id: r.id, title: r.title, mode: r.mode === "agent" ? "agent" : "chat", pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function listConversations(actor: Actor, q?: string): ConversationView[] {
  const like = q?.trim() ? `%${q.trim().replace(/[%_]/g, "")}%` : null;
  const rows = like
    ? db().prepare(`SELECT c.* FROM conversations c WHERE c.user_id = ? AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?))
                    ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`).all(actor.userId, like, like)
    : db().prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 200").all(actor.userId);
  return (rows as ConvRow[]).map(toView);
}

export function countConversations(actor: Actor): number {
  return db().prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?").get(actor.userId).n as number;
}

export function getConversation(actor: Actor, id: string): ConversationView | null {
  const r = db().prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, actor.userId) as ConvRow | undefined;
  return r ? toView(r) : null;
}

export function createConversation(actor: Actor, mode: Mode, title = "New conversation"): ConversationView {
  const id = randomId(9);
  const t = now();
  db().prepare("INSERT INTO conversations (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, actor.userId, title, mode, t, t);
  return getConversation(actor, id)!;
}

export function updateConversation(actor: Actor, id: string, patch: { title?: string; pinned?: boolean }): ConversationView {
  const cur = getConversation(actor, id);
  if (!cur) throw new NotFoundError("Conversation not found");
  db().prepare("UPDATE conversations SET title = ?, pinned = ? WHERE id = ? AND user_id = ?")
    .run((patch.title ?? cur.title).slice(0, 120), (patch.pinned ?? cur.pinned) ? 1 : 0, id, actor.userId);
  return getConversation(actor, id)!;
}

export function deleteConversation(actor: Actor, id: string): void {
  const d = db();
  d.transaction(() => {
    if (!getConversation(actor, id)) throw new NotFoundError("Conversation not found");
    d.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE id = ? AND user_id = ?)").run(id, actor.userId);
    d.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, actor.userId);
  })();
}

export function getMessages(actor: Actor, conversationId: string, limit = 500): MessageView[] {
  const rows = db().prepare(
    `SELECT * FROM (
       SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ? AND c.user_id = ? ORDER BY m.id DESC LIMIT ?
     ) ORDER BY id ASC`,
  ).all(conversationId, actor.userId, limit) as MsgRow[];
  return rows.map((r) => ({
    id: r.id, role: r.role === "assistant" ? "assistant" : "user", content: r.content, createdAt: r.created_at,
    meta: r.meta ? safeParse(r.meta) : undefined,
  }));
}

export function addMessage(actor: Actor, conversationId: string, role: "user" | "assistant", content: string, meta?: AssistantMeta): number {
  const d = db();
  const t = now();
  return d.transaction(() => {
    const info = d.prepare(
      `INSERT INTO messages (conversation_id, role, content, meta, created_at)
       SELECT id, ?, ?, ?, ? FROM conversations WHERE id = ? AND user_id = ?`,
    ).run(role, content, meta ? JSON.stringify(meta) : null, t, conversationId, actor.userId);
    if (Number(info.changes) !== 1) throw new NotFoundError("Conversation not found");
    d.prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?").run(t, conversationId, actor.userId);
    return Number(info.lastInsertRowid);
  })();
}

export function deleteMessagesFrom(actor: Actor, conversationId: string, messageId: number): void {
  db().prepare(
    "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE id = ? AND user_id = ?) AND conversation_id = ? AND id >= ?",
  ).run(conversationId, actor.userId, conversationId, messageId);
}

export function updateMessageMeta(actor: Actor, conversationId: string, messageId: number, meta: AssistantMeta): void {
  const info = db().prepare(
    "UPDATE messages SET meta = ? WHERE id = ? AND conversation_id IN (SELECT id FROM conversations WHERE id = ? AND user_id = ?)",
  ).run(JSON.stringify(meta), messageId, conversationId, actor.userId);
  if (Number(info.changes) !== 1) throw new NotFoundError("Message not found");
}

export function setTitle(actor: Actor, id: string, title: string): void {
  db().prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(title.slice(0, 120), id, actor.userId);
}

function safeParse(s: string): AssistantMeta | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}
