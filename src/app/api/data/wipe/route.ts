import { z } from "zod";
import { wipeUser } from "@/server/db";
import { route } from "@/server/http";
import { clearWorkspace } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete everything stored for this browser: keys, chats, documents, memories, designs, files. */
export const POST = route(async (c) => {
  await c.body(z.object({ confirm: z.literal(true) }));
  await wipeUser(c.userId); // also clears workspace_files
  await clearWorkspace(c.userId);
  return { ok: true };
});
