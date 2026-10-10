import { route } from "@/server/http";
import { listProfiles, setActive } from "@/server/profiles";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (c) => {
  await setActive(c.userId, c.params.id);
  return listProfiles(c.userId);
});
