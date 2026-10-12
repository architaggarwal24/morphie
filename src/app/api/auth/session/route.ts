import { loginMethods } from "@/server/auth/methods";
import { route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I? Never creates an identity: a visitor with no session simply gets authenticated:false. */
export const GET = route({ auth: "public" }, async (c) => {
  const s = c.session;
  const methods = loginMethods();
  if (!s) return { authenticated: false, isGuest: null, user: null, methods };
  const isGuest = s.actor.isGuest;
  return {
    authenticated: true,
    isGuest,
    user: isGuest ? null : { email: s.user.email, displayName: s.user.displayName },
    // Guest work is temporary: tell the UI when this browser session ends so it can warn.
    expiresAt: s.absoluteExpiresAt,
    idleExpiresAt: s.idleExpiresAt,
    methods,
  };
});
