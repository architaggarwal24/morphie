import { deleteDesign, getDesign } from "@/server/design/service";
import { route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (c) => ({ state: getDesign(c.userId, c.params.id) }));

export const DELETE = route(async (c) => {
  deleteDesign(c.userId, c.params.id);
  return { ok: true };
});
