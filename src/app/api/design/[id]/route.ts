import { deleteDesign, getDesign } from "@/server/design/service";
import { route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async (c) => ({ state: getDesign(c.actor, c.params.id) }));

export const DELETE = route({ auth: "user" }, async (c) => {
  deleteDesign(c.actor, c.params.id);
  return { ok: true };
});
