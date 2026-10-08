import { route } from "@/server/http";
import { deleteProfile, listProfiles } from "@/server/profiles";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (c) => {
  deleteProfile(c.userId, c.params.id);
  return listProfiles(c.userId);
});
