import { z } from "zod";
import { normalizeEmail } from "@/server/auth/accounts";
import { isPlausibleEmail, requestCode, CODE_TTL_MS, RESEND_COOLDOWN_MS } from "@/server/auth/otp";
import { emailLoginEnabled } from "@/server/email";
import { ApiError, route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask for a sign-in code. The answer is the same for every well-formed address (known, unknown, or in cooldown),
 * so this endpoint can't be used to find out who has an account. Never creates an identity.
 */
export const POST = route({ auth: "public", rate: { bucket: "auth-email-request", limit: 10, windowMs: 3_600_000 } }, async (c) => {
  if (!emailLoginEnabled()) throw new ApiError(404, "Email sign-in isn't available on this server.", "disabled");
  const { email } = await c.body(z.object({ email: z.string().max(254) }), 2_000);
  const e = normalizeEmail(email);
  if (!isPlausibleEmail(e)) throw new ApiError(400, "Enter a valid email address.", "invalid_email");
  requestCode(e, c.ip);
  return { ok: true, expiresInMinutes: CODE_TTL_MS / 60_000, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
});
