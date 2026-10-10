import { z } from "zod";
import { createConversation, listConversations } from "@/server/conversations";
import { route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (c) => ({ conversations: await listConversations(c.userId, c.url.searchParams.get("q") ?? undefined) }));

export const POST = route(async (c) => {
  const { mode } = await c.body(z.object({ mode: z.enum(["chat", "agent"]).default("chat") }));
  return { conversation: await createConversation(c.userId, mode) };
});
