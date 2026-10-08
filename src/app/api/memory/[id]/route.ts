import { route } from "@/server/http";
import { deleteMemory, listMemories } from "@/server/memory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (c) => {
  deleteMemory(c.userId, c.params.id);
  return { memories: listMemories(c.userId) };
});
