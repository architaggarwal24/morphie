import { z } from "zod";
import { decide } from "@/server/agent/approvals";
import { ApiError, route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route({ auth: "guest" }, async (c) => {
  const b = await c.body(z.object({ id: z.string().max(40), approved: z.boolean(), always: z.boolean().optional() }));
  if (!decide(c.actor.userId, b.id, { approved: b.approved, always: b.always })) {
    throw new ApiError(410, "That request has already been answered or has expired.", "expired");
  }
  return { ok: true };
});
