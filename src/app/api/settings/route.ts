import { z } from "zod";
import { config } from "@/server/config";
import { route } from "@/server/http";
import { getSettings, saveSettings } from "@/server/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "guest" }, async (c) => getSettings(c.actor));

const body = z.object({
  maxSteps: z.number().int().min(2).max(100).optional(),
  approval: z.enum(["ask", "always", "never"]).optional(),
  alwaysAllow: z.array(z.string().max(40)).max(40).optional(),
  disabledTools: z.array(z.string().max(40)).max(40).optional(),
  memory: z.boolean().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

export const PUT = route({ auth: "guest" }, async (c) => {
  const { temperature, maxSteps, ...rest } = await c.body(body);
  return saveSettings(c.actor, {
    ...rest,
    ...(maxSteps ? { maxSteps: Math.min(maxSteps, config.maxAgentSteps) } : {}),
    ...(temperature === undefined ? {} : { temperature: temperature ?? undefined }),
  });
});
