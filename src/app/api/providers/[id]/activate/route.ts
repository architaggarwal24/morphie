import { route } from "@/server/http";
import { listProfiles, setActive } from "@/server/profiles";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route({ auth: "user" }, async (c) => {
  setActive(c.actor, c.params.id);
  return listProfiles(c.actor);
});
