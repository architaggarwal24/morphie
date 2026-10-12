import { beginLogin, getProvider, redirectUriFor, safeReturnTo } from "@/server/auth/oauth";
import { oauthCookie } from "@/server/auth/login";
import { ApiError, route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send the browser to Google/GitHub. A random state (and PKCE verifier) is stored server-side; the state is also set as a cookie. */
export const GET = route({ auth: "public", rate: { bucket: "auth-oauth-start", limit: 20, windowMs: 3_600_000 } }, async (c) => {
  const provider = getProvider(c.params.provider);
  if (!provider) throw new ApiError(404, "That sign-in method isn't available.", "disabled");
  const { url, state } = beginLogin(provider, redirectUriFor(provider.id, c.req), safeReturnTo(c.url.searchParams.get("returnTo")));
  c.cookies.push(oauthCookie(state, c.req));
  return new Response(null, { status: 302, headers: { location: url.toString() } });
});
