import { z } from "zod";
import { createConversation, listConversations } from "@/server/conversations";
import { route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async (c) => ({ conversations: listConversations(c.actor, c.url.searchParams.get("q") ?? undefined) }));

export const POST = route({ auth: "user" }, async (c) => {
  const { mode } = await c.body(z.object({ mode: z.enum(["chat", "agent"]).default("chat") }));
  return { conversation: createConversation(c.actor, mode) };
});
