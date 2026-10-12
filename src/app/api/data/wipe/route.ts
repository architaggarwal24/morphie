import { z } from "zod";
import { wipeContent } from "@/server/data/users";
import { route } from "@/server/http";
import { clearWorkspace } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete everything stored for this browser: keys, chats, documents, memories, designs, files. */
export const POST = route({ auth: "guest" }, async (c) => {
  await c.body(z.object({ confirm: z.literal(true) }));
  wipeContent(c.actor);
  clearWorkspace(c.actor);
  return { ok: true };
});
