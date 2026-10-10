import { z } from "zod";
import { runAgent } from "@/server/agent/loop";
import { LIMITS } from "@/server/config";
import { tryLock } from "@/server/coordinator";
import { createConversation, deleteMessagesFrom, getConversation, getMessages } from "@/server/conversations";
import { ApiError, route } from "@/server/http";
import { activeProvider } from "@/server/providers/active";
import { getSettings } from "@/server/settings";
import { sse } from "@/server/sse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({
  conversationId: z.string().max(40).optional(),
  mode: z.enum(["chat", "agent"]).default("chat"),
  message: z.string().trim().min(1, "Type a message first.").max(LIMITS.message, `Messages can be up to ${LIMITS.message.toLocaleString()} characters.`),
  /** Edit/regenerate: drop this user message and everything after it, then run again. */
  truncateFrom: z.number().int().positive().optional(),
});

/** Streams AgentEvents as server-sent events. */
export const POST = route(async (c) => {
  const b = await c.body(body);
  const provider = await activeProvider(c.userId);
  const settings = await getSettings(c.userId);

  let conv = b.conversationId ? await getConversation(c.userId, b.conversationId) : null;
  if (b.conversationId && !conv) throw new ApiError(404, "That conversation no longer exists.", "not_found");

  // "This conversation is busy" guard. It lives in the user's Coordinator Durable Object, not in process memory,
  // so it holds across isolates; the TTL frees it if a run dies without cleaning up.
  let release: (() => Promise<void>) | null = null;
  if (conv) {
    release = await tryLock(c.userId, `conv:${conv.id}`);
    if (!release) throw new ApiError(409, "This conversation is still working on a reply.", "busy");
  }
  try {
    if (conv && b.truncateFrom) {
      const target = (await getMessages(c.userId, conv.id)).find((m) => m.id === b.truncateFrom);
      if (!target || target.role !== "user") throw new ApiError(400, "Only your own messages can be edited or re-run.", "invalid");
      await deleteMessagesFrom(c.userId, conv.id, b.truncateFrom);
    }
    conv ??= await createConversation(c.userId, b.mode);
    release ??= await tryLock(c.userId, `conv:${conv.id}`);
  } catch (e) {
    await release?.();
    throw e;
  }
  const conversation = conv;
  const unlock = release;

  return sse(c.req, async (emit, signal) => {
    try {
      await runAgent({ userId: c.userId, conversationId: conversation.id, mode: conversation.mode, message: b.message, provider, settings, signal, emit });
    } finally {
      await unlock?.();
    }
  });
}, { rate: { bucket: "chat", limit: 40, windowMs: 60_000 } });
