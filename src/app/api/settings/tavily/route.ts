import { z } from "zod";
import { config } from "@/server/config";
import { route } from "@/server/http";
import { deleteSecret, getSecret, setSecret } from "@/server/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const state = async (userId: string) => ({ user: !!(await getSecret(userId, "tavily")), server: !!config.tavilyKey });

export const PUT = route(async (c) => {
  const { key } = await c.body(z.object({ key: z.string().trim().min(8, "That key looks too short.").max(300).regex(/^\S+$/, "Keys can't contain spaces.") }));
  await setSecret(c.userId, "tavily", key);
  return state(c.userId);
});

export const DELETE = route(async (c) => {
  await deleteSecret(c.userId, "tavily");
  return state(c.userId);
});
