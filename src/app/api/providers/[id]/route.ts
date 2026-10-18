import { route } from "@/server/http";
import { deleteProfile, listProfiles } from "@/server/profiles";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route({ auth: "user" }, async (c) => {
  deleteProfile(c.actor, c.params.id);
  return listProfiles(c.actor);
});
