import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bootstrap from "@/app/api/bootstrap/route";
import * as logout from "@/app/api/auth/logout/route";
import * as logoutAll from "@/app/api/auth/logout-all/route";
import * as sessionRoute from "@/app/api/auth/session/route";
import * as providerTest from "@/app/api/providers/test/route";
import * as conversations from "@/app/api/conversations/route";
import { config } from "@/server/config";
import { hashToken, resolveSession, revokeAllSessions, revokeSession, rotateSession, startSession, createGuestUser } from "@/server/auth/session";
import { createConversation, listConversations } from "@/server/conversations";
import { sign, sha256 } from "@/server/crypto";
import { db } from "@/server/db";
import { _resetRateLimits } from "@/server/security";
import { Client } from "./helpers/client";
import { testActor } from "./helpers/actor";
import { makeUser, signIn } from "./helpers/users";

const HTTPS = "https://morphie.test";
const count = (sql: string, ...p: unknown[]) => db().prepare(sql).get(...p).n as number;

beforeEach(() => _resetRateLimits());
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("session cookies", () => {
  it("guest over http: plain name, HttpOnly, SameSite=Lax, no Max-Age, no Secure", async () => {
    const c = new Client();
    const res = await c.call(bootstrap.GET, "/api/bootstrap");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^morphie_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/Path=\//); expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Max-Age|Expires|Secure|Domain/i);
  });

  it("over https: __Host- prefix, Secure, no Domain; and the plain cookie is never accepted", async () => {
    const c = new Client(HTTPS);
    const res = await c.call(bootstrap.GET, "/api/bootstrap");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-morphie_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/Path=\//); expect(cookie).not.toMatch(/Domain/i);
    // A plain-named cookie (e.g. planted by a sibling subdomain) must be ignored over https.
    const planted = new Client(HTTPS);
    const g = createGuestUser(); const s = startSession(g, true);
    planted.jar.set("morphie_session", s.token);
    const r = await planted.call(bootstrap.GET, "/api/bootstrap");
    expect(r.headers.get("set-cookie")).toMatch(/^__Host-morphie_session=/); // got a brand-new session instead
    const fresh = planted.jar.get("__Host-morphie_session")!;
    expect(fresh).not.toBe(s.token);
    expect(resolveSession(fresh)?.actor.userId).not.toBe(g); // a different identity: the planted session was not adopted
  });

  it("trusts x-forwarded-proto only behind a trusted proxy", async () => {
    const spoof = new Client(ORIGIN_HTTP, { "x-forwarded-proto": "https" });
    expect((await spoof.call(bootstrap.GET, "/api/bootstrap")).headers.get("set-cookie")).toMatch(/^morphie_session=/);
    vi.stubEnv("MORPHIE_TRUSTED_PROXY", "1");
    const behind = new Client(ORIGIN_HTTP, { "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.1" });
    const res = await behind.call(bootstrap.GET, "/api/bootstrap");
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-morphie_session=.*Secure/);
  });

  it("an account session gets a persistent cookie whose Max-Age equals its absolute expiry", async () => {
    const { userId } = makeUser();
    const s = startSession(userId, false);
    const { sessionCookie } = await import("@/server/auth/session");
    const cookie = sessionCookie(s.token, s, new Request("http://localhost:3000/"));
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
    expect(Math.abs(maxAge - config.userMaxMs / 1000)).toBeLessThan(5);
  });

  it("stores only the SHA-256 of the token, never the token", () => {
    const { userId } = makeUser();
    const s = startSession(userId, false);
    const rows = db().prepare("SELECT * FROM sessions WHERE user_id = ?").all(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sha256(s.token));
    expect(JSON.stringify(rows)).not.toContain(s.token);
    expect(hashToken(s.token)).toBe(s.sessionId);
  });

  it("ignores forged, truncated and unknown tokens", async () => {
    for (const bad of ["x", "A".repeat(43), "A".repeat(42), "../../etc/passwd", "A".repeat(300)]) {
      const c = new Client(); c.jar.set("morphie_session", bad);
      const res = await c.call(bootstrap.GET, "/api/bootstrap");
      expect(res.status).toBe(200);
      expect(c.sessionToken).not.toBe(bad);
    }
  });
});
const ORIGIN_HTTP = "http://localhost:3000";

describe("expiry", () => {
  it("guests: idle TTL (default 120 min) slides with activity but never passes the hard max (24 h)", () => {
    const g = createGuestUser(0);
    const s = startSession(g, true, {}, 0);
    expect(s.idleExpiresAt).toBe(120 * 60_000);
    expect(s.absoluteExpiresAt).toBe(24 * 3_600_000);
    expect(resolveSession(s.token, 119 * 60_000)).not.toBeNull();       // active just inside the idle window
    expect(resolveSession(s.token, 119 * 60_000 + 61_000)).not.toBeNull(); // the touch slid the window forward
    // keep it busy every 100 minutes until the hard max
    let t = 119 * 60_000 + 61_000;
    while (t + 100 * 60_000 < 24 * 3_600_000) { t += 100 * 60_000; expect(resolveSession(s.token, t)).not.toBeNull(); }
    expect(resolveSession(s.token, 24 * 3_600_000)).toBeNull();          // absolute expiry wins over activity
  });

  it("guests: expire after the idle TTL with no activity", () => {
    const s = startSession(createGuestUser(0), true, {}, 0);
    expect(resolveSession(s.token, 120 * 60_000 + 1)).toBeNull();
  });

  it("idle and maximum TTLs are configurable", () => {
    vi.stubEnv("MORPHIE_GUEST_IDLE_MIN", "10"); vi.stubEnv("MORPHIE_GUEST_MAX_HOURS", "1");
    const s = startSession(createGuestUser(0), true, {}, 0);
    expect(s.idleExpiresAt).toBe(10 * 60_000);
    expect(s.absoluteExpiresAt).toBe(3_600_000);
    expect(resolveSession(s.token, 10 * 60_000 + 1)).toBeNull();
  });

  it("accounts: 14 days idle, 30 days absolute", () => {
    const { userId } = makeUser();
    const s = startSession(userId, false, {}, 0);
    expect(s.idleExpiresAt).toBe(14 * 86_400_000);
    expect(s.absoluteExpiresAt).toBe(30 * 86_400_000);
    expect(resolveSession(s.token, 13 * 86_400_000)).not.toBeNull();
    expect(resolveSession(s.token, 40 * 86_400_000)).toBeNull();
  });

  it("an expired session means a brand-new, empty identity at the route level", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = new Client();
    await c.call(bootstrap.GET, "/api/bootstrap");
    const first = (await c.json(sessionRoute.GET, "/api/auth/session")).data;
    expect(first).toMatchObject({ authenticated: true, isGuest: true, user: null });
    const owner = db().prepare("SELECT user_id FROM sessions WHERE id = ?").get(hashToken(c.sessionToken!)).user_id as string;
    createConversation(testActor(owner), "chat");
    vi.setSystemTime(new Date("2026-01-01T02:01:00Z")); // 121 minutes idle
    expect((await c.json(sessionRoute.GET, "/api/auth/session")).data.authenticated).toBe(false); // public route: sees no session
    const again = await c.json(conversations.GET, "/api/conversations");
    expect(again.data.conversations).toEqual([]); // new identity, none of the old data
  });
});

describe("rotation and revocation", () => {
  it("rotation issues a fresh token, kills the old one immediately and keeps the user", () => {
    const { userId } = makeUser();
    const a = startSession(userId, false);
    const b = rotateSession(a.sessionId, { userId, isGuest: false });
    expect(b.token).not.toBe(a.token);
    expect(resolveSession(a.token)).toBeNull();
    expect(resolveSession(b.token)?.actor.userId).toBe(userId);
    expect(db().prepare("SELECT revoked_at FROM sessions WHERE id = ?").get(a.sessionId).revoked_at).not.toBeNull();
  });

  it("privilege change: a guest session rotates into a user session for another user, linking the guest", () => {
    const guest = createGuestUser(); const g = startSession(guest, true);
    const { userId } = makeUser();
    const u = rotateSession(g.sessionId, { userId, isGuest: false, linkedGuestUserId: guest });
    expect(resolveSession(g.token)).toBeNull();
    const r = resolveSession(u.token)!;
    expect(r.actor).toMatchObject({ userId, isGuest: false });
    expect(r.linkedGuestUserId).toBe(guest);
  });

  it("revokeSession and revokeAllSessions take effect on the next request", () => {
    const { userId } = makeUser();
    const [a, b, c] = [startSession(userId, false), startSession(userId, false), startSession(userId, false)];
    expect(revokeSession(a.sessionId)).toBe(true);
    expect(revokeSession(a.sessionId)).toBe(false); // already revoked
    expect(resolveSession(a.token)).toBeNull();
    expect(revokeAllSessions(userId)).toBe(2);
    expect(resolveSession(b.token)).toBeNull(); expect(resolveSession(c.token)).toBeNull();
  });

  it("a revoked cookie does not resurrect: the route starts a different guest", async () => {
    const guest = createGuestUser(); const s = startSession(guest, true);
    const c = new Client(); c.jar.set("morphie_session", s.token);
    revokeSession(s.sessionId);
    await c.call(bootstrap.GET, "/api/bootstrap");
    expect(c.sessionToken).not.toBe(s.token);
    expect(resolveSession(c.sessionToken!)?.actor.userId).not.toBe(guest);
  });
});

describe("logout and logout-all", () => {
  it("logout revokes the session, clears the cookie, and is idempotent", async () => {
    const c = new Client();
    await c.call(bootstrap.GET, "/api/bootstrap");
    const token = c.sessionToken!;
    const res = await c.call(logout.POST, "/api/auth/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/^morphie_session=;.*Max-Age=0/);
    expect(resolveSession(token)).toBeNull();
    expect(c.sessionToken).toBeUndefined();
    expect((await c.json(logout.POST, "/api/auth/logout", { method: "POST" })).status).toBe(200); // nothing to revoke: still fine
    expect(count("SELECT COUNT(*) AS n FROM users")).toBeGreaterThan(0);
  });

  it("logout needs a same-origin request (CSRF)", async () => {
    const c = new Client(); await c.call(bootstrap.GET, "/api/bootstrap");
    expect((await c.json(logout.POST, "/api/auth/logout", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
    expect(resolveSession(c.sessionToken!)).not.toBeNull();
  });

  it("logout-all signs the user out of every browser and leaves other users alone", async () => {
    const { userId } = makeUser();
    const other = makeUser();
    const [a, b, c] = [new Client(), new Client(), new Client()];
    const sa = signIn(a, userId), sb = signIn(b, userId), sc = signIn(c, userId);
    const bystander = new Client(); signIn(bystander, other.userId);
    const res = await a.json(logoutAll.POST, "/api/auth/logout-all", { method: "POST" });
    expect(res.status).toBe(200); expect(res.data.revoked).toBe(3);
    for (const s of [sa, sb, sc]) expect(resolveSession(s.token)).toBeNull();
    expect((await b.json(sessionRoute.GET, "/api/auth/session")).data.authenticated).toBe(false);
    expect((await bystander.json(sessionRoute.GET, "/api/auth/session")).data).toMatchObject({ authenticated: true, isGuest: false });
  });
});

describe("auth levels", () => {
  it("public routes never create an identity or a cookie", async () => {
    const before = count("SELECT COUNT(*) AS n FROM users"); const sess = count("SELECT COUNT(*) AS n FROM sessions");
    const c = new Client();
    const res = await c.call(sessionRoute.GET, "/api/auth/session");
    expect(await res.json()).toMatchObject({ authenticated: false, isGuest: null, user: null });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(count("SELECT COUNT(*) AS n FROM users")).toBe(before);
    expect(count("SELECT COUNT(*) AS n FROM sessions")).toBe(sess);
  });

  it("user routes: 401 with no session (creating nothing), 403 for a guest, OK for an account", async () => {
    const before = count("SELECT COUNT(*) AS n FROM users");
    const anon = new Client();
    const r1 = await anon.call(logoutAll.POST, "/api/auth/logout-all", { method: "POST" });
    expect(r1.status).toBe(401); expect(r1.headers.get("set-cookie")).toBeNull();
    expect(count("SELECT COUNT(*) AS n FROM users")).toBe(before);
    const guest = new Client(); await guest.call(bootstrap.GET, "/api/bootstrap");
    const r2 = await guest.json(logoutAll.POST, "/api/auth/logout-all", { method: "POST" });
    expect(r2.status).toBe(403); expect(r2.data.code).toBe("account_required");
    const user = new Client(); signIn(user, makeUser().userId);
    expect((await user.json(logoutAll.POST, "/api/auth/logout-all", { method: "POST" })).status).toBe(200);
  });

  it("GET /api/auth/session tells a guest when the session ends, and an account who they are", async () => {
    const g = new Client(); await g.call(bootstrap.GET, "/api/bootstrap");
    const gs = (await g.json(sessionRoute.GET, "/api/auth/session")).data;
    expect(gs).toMatchObject({ authenticated: true, isGuest: true, user: null });
    expect(gs.expiresAt).toBeGreaterThan(Date.now()); expect(gs.idleExpiresAt).toBeLessThanOrEqual(gs.expiresAt);
    const u = new Client(); const { userId, email } = makeUser("Ada@Example.com"); signIn(u, userId);
    expect((await u.json(sessionRoute.GET, "/api/auth/session")).data).toMatchObject({ authenticated: true, isGuest: false, user: { email, displayName: "Test User" } });
  });
});

describe("identity flooding", () => {
  const withProxy = (ip: string) => ({ "x-forwarded-for": ip });

  it("caps new identities per IP per hour: 429, no users row, no cookie", async () => {
    vi.stubEnv("MORPHIE_TRUSTED_PROXY", "1"); vi.stubEnv("MORPHIE_MAX_NEW_IDENTITIES_PER_HOUR", "3");
    const before = count("SELECT COUNT(*) AS n FROM users");
    for (let i = 0; i < 3; i++) expect((await new Client(ORIGIN_HTTP, withProxy("203.0.113.7")).call(bootstrap.GET, "/api/bootstrap")).status).toBe(200);
    const blocked = await new Client(ORIGIN_HTTP, withProxy("203.0.113.7")).call(bootstrap.GET, "/api/bootstrap");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect(count("SELECT COUNT(*) AS n FROM users")).toBe(before + 3);
    // another network is unaffected, and a returning visitor (has a cookie) is not an "identity" at all
    expect((await new Client(ORIGIN_HTTP, withProxy("203.0.113.8")).call(bootstrap.GET, "/api/bootstrap")).status).toBe(200);
  });

  it("a forged x-forwarded-for cannot dodge the cap, and a returning session is never counted", async () => {
    vi.stubEnv("MORPHIE_TRUSTED_PROXY", "1"); vi.stubEnv("MORPHIE_MAX_NEW_IDENTITIES_PER_HOUR", "2");
    const real = "198.51.100.20";
    const returning = new Client(ORIGIN_HTTP, withProxy(real));
    await returning.call(bootstrap.GET, "/api/bootstrap");
    await new Client(ORIGIN_HTTP, withProxy(real)).call(bootstrap.GET, "/api/bootstrap");
    // the attacker prepends fake hops; the proxy still appends the real one last
    const forged = new Client(ORIGIN_HTTP, withProxy(`1.1.1.${1}, ${real}`));
    expect((await forged.call(bootstrap.GET, "/api/bootstrap")).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await returning.call(bootstrap.GET, "/api/bootstrap")).status).toBe(200);
  });

  it("without a trusted proxy every client shares the 'unknown' bucket (and spoofed headers are ignored)", async () => {
    vi.stubEnv("MORPHIE_MAX_NEW_IDENTITIES_PER_HOUR", "2");
    expect((await new Client(ORIGIN_HTTP, withProxy("1.1.1.1")).call(bootstrap.GET, "/api/bootstrap")).status).toBe(200);
    expect((await new Client(ORIGIN_HTTP, withProxy("2.2.2.2")).call(bootstrap.GET, "/api/bootstrap")).status).toBe(200);
    expect((await new Client(ORIGIN_HTTP, withProxy("3.3.3.3")).call(bootstrap.GET, "/api/bootstrap")).status).toBe(429);
  });

  it("per-IP rate limits cannot be escaped by rotating cookies", async () => {
    vi.stubEnv("MORPHIE_TRUSTED_PROXY", "1");
    let limited = 0;
    for (let i = 0; i < 45; i++) {
      const fresh = new Client(ORIGIN_HTTP, withProxy("192.0.2.99")); // new cookie every time: per-user bucket never fills
      const r = await fresh.json(providerTest.POST, "/api/providers/test", { method: "POST", body: {} });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0); // 12/min per user x3 = 36 per IP
  });

  it("a global per-IP request ceiling applies to every route", async () => {
    vi.stubEnv("MORPHIE_TRUSTED_PROXY", "1"); vi.stubEnv("MORPHIE_IP_RATE_PER_MIN", "5");
    const c = new Client(ORIGIN_HTTP, withProxy("192.0.2.50"));
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.call(sessionRoute.GET, "/api/auth/session")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });
});

describe("legacy morphie_uid cookie shim", () => {
  const legacyCookie = (id: string) => `${id}.${sign(id)}`;
  const seedLegacy = () => {
    const id = "legacyuser_" + Math.random().toString(36).slice(2, 12).padEnd(10, "x");
    db().prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(id, Date.now()); // as the old code did: no sessions, no flags
    return id;
  };

  it("turns a valid old cookie into a guest session for the SAME user, and clears the old cookie", async () => {
    const id = seedLegacy();
    createConversation(testActor(id), "chat", "Kept across the upgrade");
    const c = new Client(); c.jar.set("morphie_uid", legacyCookie(id));
    const res = await c.call(conversations.GET, "/api/conversations");
    expect((await res.json()).conversations.map((x: any) => x.title)).toEqual(["Kept across the upgrade"]);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((x) => x.startsWith("morphie_session="))).toBe(true);
    expect(cookies.some((x) => /^morphie_uid=;.*Max-Age=0/.test(x))).toBe(true);
    expect(c.jar.has("morphie_uid")).toBe(false);
    // the next request needs only the new cookie
    expect((await c.json(conversations.GET, "/api/conversations")).data.conversations).toHaveLength(1);
    expect(resolveSession(c.sessionToken!)?.actor).toMatchObject({ userId: id, isGuest: true });
  });

  it("rejects forged signatures, unknown users, and is switchable off", async () => {
    const id = seedLegacy();
    const forged = new Client(); forged.jar.set("morphie_uid", `${id}.${"A".repeat(32)}`);
    await forged.call(bootstrap.GET, "/api/bootstrap");
    expect(resolveSession(forged.sessionToken!)?.actor.userId).not.toBe(id);
    const ghost = new Client(); ghost.jar.set("morphie_uid", legacyCookie("neverexisted_user_0000001"));
    await ghost.call(bootstrap.GET, "/api/bootstrap");
    expect(resolveSession(ghost.sessionToken!)?.actor.userId).not.toBe("neverexisted_user_0000001");
    vi.stubEnv("MORPHIE_ACCEPT_LEGACY_COOKIE", "false");
    const off = new Client(); off.jar.set("morphie_uid", legacyCookie(id));
    await off.call(bootstrap.GET, "/api/bootstrap");
    expect(resolveSession(off.sessionToken!)?.actor.userId).not.toBe(id);
  });

  it("public routes and user-level routes never run the shim (they must not create sessions)", async () => {
    const id = seedLegacy();
    const c = new Client(); c.jar.set("morphie_uid", legacyCookie(id));
    const res = await c.call(sessionRoute.GET, "/api/auth/session");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await c.call(logoutAll.POST, "/api/auth/logout-all", { method: "POST" })).status).toBe(401);
  });

  it("is isolated to one file and one call site so it can be deleted", async () => {
    const fs = await import("node:fs"); const path = await import("node:path");
    const hits: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(f, "utf8").includes("REMOVE-LEGACY-SHIM")) hits.push(f); } };
    walk("src");
    expect(hits.map((h) => h.replace(/\\/g, "/")).sort()).toEqual(["src/server/auth/legacyCookie.ts", "src/server/http.ts"]);
    const calls = fs.readFileSync("src/server/http.ts", "utf8").split("\n").filter((l) => l.includes("REMOVE-LEGACY-SHIM"));
    expect(calls).toHaveLength(1);
  });
});
