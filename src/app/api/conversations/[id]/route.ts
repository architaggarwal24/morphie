import { z } from "zod";
import { deleteConversation, getConversation, getMessages, updateConversation } from "@/server/conversations";
import { ApiError, route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "guest" }, async (c) => {
  const conversation = getConversation(c.actor, c.params.id);
  if (!conversation) throw new ApiError(404, "That conversation no longer exists.", "not_found");
  return { conversation, messages: getMessages(c.actor, c.params.id) };
});

export const PATCH = route({ auth: "guest" }, async (c) => {
  const b = await c.body(z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }));
  const conversation = updateConversation(c.actor, c.params.id, b);
  if (!conversation) throw new ApiError(404, "That conversation no longer exists.", "not_found");
  return { conversation };
});

export const DELETE = route({ auth: "guest" }, async (c) => {
  deleteConversation(c.actor, c.params.id);
  return { ok: true };
});
