import nodeCrypto from "node:crypto";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bootstrap from "@/app/api/bootstrap/route";
import * as emailRequest from "@/app/api/auth/email/request/route";
import * as emailVerify from "@/app/api/auth/email/verify/route";
import * as oauthStart from "@/app/api/auth/oauth/[provider]/start/route";
import * as oauthCallback from "@/app/api/auth/oauth/[provider]/callback/route";
import * as sessionRoute from "@/app/api/auth/session/route";
import * as conversations from "@/app/api/conversations/route";
import { findUserByEmail, loginWithProvider, type Provider, type VerifiedProfile } from "@/server/auth/accounts";
import {
  githubProvider, googleProvider, OAuthError, pkceChallenge, safeReturnTo, setProviderOverrides, type FetchLike, type OAuthProvider,
} from "@/server/auth/oauth";
import { CODE_TTL_MS, MAX_ATTEMPTS, MAX_CODES_PER_HOUR, RESEND_COOLDOWN_MS, requestCode, verifyCode } from "@/server/auth/otp";
import { hashToken, resolveSession } from "@/server/auth/session";
import { createConversation } from "@/server/conversations";
import { sha256 } from "@/server/crypto";
import { db } from "@/server/db";
import { _resetTransportForTests, createTransport, MemoryTransport, ResendTransport, SmtpTransport, transport, transportName } from "@/server/email";
import { _resetRateLimits } from "@/server/security";
import { testActor } from "./helpers/actor";
import { Client } from "./helpers/client";

const n = (sql: string, ...p: unknown[]) => db().prepare(sql).get(...p).n as number;
const outbox = () => (transport() as MemoryTransport).outbox;
const lastCode = (to: string): string => {
  const m = [...outbox()].reverse().find((x) => x.to === to);
  expect(m, `an email to ${to}`).toBeTruthy();
  return /\b(\d{6})\b/.exec(m!.text)![1];
};
let seq = 0;
const email = (tag = "p") => `${tag}${++seq}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const ask = (c: Client, address: string) => c.json(emailRequest.POST, "/api/auth/email/request", { method: "POST", body: { email: address } });
const verify = (c: Client, address: string, code: string) => c.json(emailVerify.POST, "/api/auth/email/verify", { method: "POST", body: { email: address, code } });

beforeEach(() => { _resetRateLimits(); _resetTransportForTests(); setProviderOverrides(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); setProviderOverrides(undefined); });

// ------------------------------------------------------------------ email codes
describe("email one-time code", () => {
  it("emails a 6-digit code; the same tab verifies it, creating the account and rotating the guest session", async () => {
    const tab = new Client();
    await tab.call(bootstrap.GET, "/api/bootstrap"); // a guest, with some work
    const guestToken = tab.sessionToken!;
    const guestId = resolveSession(guestToken)!.actor.userId;
    createConversation(testActor(guestId), "chat", "Guest work");
    const addr = email();
    const r = await ask(tab, addr);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, expiresInMinutes: 10, resendAfterSeconds: 60 });
    const code = lastCode(addr);
    expect(code).toMatch(/^\d{6}$/);
    expect(outbox().find((m) => m.to === addr)!.text).not.toMatch(/https?:\/\//); // a code, not a link
    expect(findUserByEmail(addr)).toBeNull(); // nothing is created until the code is proven

    const v = await verify(tab, addr, code);
    expect(v.status).toBe(200);
    expect(v.data).toMatchObject({ ok: true, created: true, guestLinked: true, user: { email: addr } });
    expect(resolveSession(guestToken)).toBeNull();                       // old (guest) token is dead: rotated
    const now = resolveSession(tab.sessionToken!)!;
    expect(now.actor.isGuest).toBe(false);
    expect(now.user.email).toBe(addr);
    expect(now.linkedGuestUserId).toBe(guestId);                          // remembered for the claim step
    expect(n("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?", guestId)).toBe(1); // nothing merged or lost yet
    expect(tab.jar.get("morphie_session")).not.toBe(guestToken);
  });

  it("a returning user (same email, any casing/whitespace) gets the same account", async () => {
    const addr = email("ada");
    const first = new Client(); await ask(first, addr); const a = await verify(first, addr, lastCode(addr));
    expect(a.data.created).toBe(true);
    _resetRateLimits();
    const again = new Client();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + RESEND_COOLDOWN_MS + 1000);
    await ask(again, `  ${addr.toUpperCase()}  `);
    const b = await verify(again, addr.toUpperCase(), lastCode(addr));
    expect(b.data).toMatchObject({ ok: true, created: false });
    expect(resolveSession(again.sessionToken!)!.actor.userId).toBe(resolveSession(first.sessionToken!)!.actor.userId);
  });

  it("works for a visitor with no session at all (nothing to link)", async () => {
    const addr = email(); const c = new Client();
    await ask(c, addr);
    const v = await verify(c, addr, lastCode(addr));
    expect(v.data).toMatchObject({ ok: true, guestLinked: false });
  });

  it("a code works exactly once: a replay fails, and so does a simultaneous double-submit", async () => {
    const addr = email(); const a = new Client();
    await ask(a, addr); const code = lastCode(addr);
    expect((await verify(a, addr, code)).status).toBe(200);
    expect((await verify(new Client(), addr, code)).status).toBe(400); // replayed
    const addr2 = email(); await ask(new Client(), addr2); const code2 = lastCode(addr2);
    const results = await Promise.all([verify(new Client(), addr2, code2), verify(new Client(), addr2, code2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it("expires after 10 minutes", async () => {
    const addr = email(); const t0 = Date.now();
    requestCode(addr, "x", t0);
    const code = lastCode(addr);
    expect(verifyCode(addr, code, t0 + CODE_TTL_MS + 1).ok).toBe(false);
    requestCode(addr, "x", t0 + 3 * RESEND_COOLDOWN_MS); // a fresh code is fine
    expect(verifyCode(addr, lastCode(addr), t0 + 3 * RESEND_COOLDOWN_MS + CODE_TTL_MS - 1).ok).toBe(true);
  });

  it("allows 5 wrong guesses, then the real code is dead too", () => {
    const addr = email(); const t = Date.now();
    requestCode(addr, "x", t); const code = lastCode(addr);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(verifyCode(addr, wrong, t + 1000).ok).toBe(false);
    expect(verifyCode(addr, code, t + 2000).ok).toBe(false);
    expect(findUserByEmail(addr)).toBeNull();
  });

  it("only the newest code is valid, and resend honours the cooldown and the hourly cap", () => {
    const addr = email(); const t = Date.now();
    requestCode(addr, "x", t);
    const first = lastCode(addr);
    requestCode(addr, "x", t + 1000);                          // inside the cooldown: no new mail
    expect(outbox().filter((m) => m.to === addr)).toHaveLength(1);
    requestCode(addr, "x", t + RESEND_COOLDOWN_MS + 1);
    expect(outbox().filter((m) => m.to === addr)).toHaveLength(2);
    expect(verifyCode(addr, first, t + RESEND_COOLDOWN_MS + 2).ok).toBe(false); // superseded (unless the two codes collide)
    for (let i = 2; i < MAX_CODES_PER_HOUR + 3; i++) requestCode(addr, "x", t + i * (RESEND_COOLDOWN_MS + 1));
    expect(outbox().filter((m) => m.to === addr).length).toBeLessThanOrEqual(MAX_CODES_PER_HOUR);
  });

  it("stores only a keyed hash: no plaintext code, and not a bare SHA-256 either", () => {
    const addr = email(); requestCode(addr, "x", Date.now());
    const code = lastCode(addr);
    const row = db().prepare("SELECT * FROM email_codes WHERE email = ?").get(addr);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    for (const guess of [sha256(code), sha256(addr + code), sha256(`${addr}|${row.id}|${code}`)]) expect(row.code_hash).not.toBe(guess);
  });

  it("malformed input: bad email is 400; wrong-shaped codes fail like any other wrong code", async () => {
    const c = new Client();
    for (const bad of ["", "nope", "a@b", "a b@c.com", "x".repeat(300) + "@a.com"]) expect((await ask(c, bad)).status).toBe(400);
    const addr = email(); await ask(c, addr);
    const wrongShape = await verify(c, addr, "12ab56");
    const wrongCode = await verify(c, addr, "000000");
    expect(wrongShape.status).toBe(400); expect(wrongShape.data).toEqual(wrongCode.data);
  });

  it("per-IP limits: too many requests from one network get a 429", async () => {
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await ask(new Client(), email())).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------- enumeration
describe("no account enumeration", () => {
  it("requesting a code answers identically for a known and an unknown address, and sends a code to both", async () => {
    const known = email("known"); const c = new Client();
    await ask(c, known); await verify(c, known, lastCode(known)); // now a real account
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 2 * RESEND_COOLDOWN_MS);
    const unknown = email("unknown");
    const before = { users: n("SELECT COUNT(*) AS n FROM users"), codes: n("SELECT COUNT(*) AS n FROM email_codes") };
    const a = await ask(new Client(), known), b = await ask(new Client(), unknown);
    expect(a.status).toBe(b.status);
    expect(a.data).toEqual(b.data);
    expect([...a.headers.keys()].sort()).toEqual([...b.headers.keys()].sort());
    expect(a.headers.get("set-cookie")).toBeNull(); expect(b.headers.get("set-cookie")).toBeNull();
    expect(outbox().filter((m) => m.to === known || m.to === unknown)).toHaveLength(3); // known: first + new; unknown: one
    expect(lastCode(unknown)).toMatch(/^\d{6}$/);
    expect(n("SELECT COUNT(*) AS n FROM users")).toBe(before.users);   // asking creates nobody
    expect(n("SELECT COUNT(*) AS n FROM email_codes")).toBe(before.codes + 2);
  });

  it("verifying fails identically for: unknown address, wrong code, expired code, used code", async () => {
    const known = email(); await ask(new Client(), known); const code = lastCode(known);
    const wrong = code === "000000" ? "111111" : "000000";
    const unknown = await verify(new Client(), email("ghost"), "123456");
    const wrongCode = await verify(new Client(), known, wrong);
    expect(unknown.status).toBe(400); expect(wrongCode.status).toBe(400);
    expect(unknown.data).toEqual(wrongCode.data);
    await verify(new Client(), known, code); // use it
    const used = await verify(new Client(), known, code);
    expect(used.data).toEqual(unknown.data);
    expect(JSON.stringify([unknown.data, wrongCode.data])).not.toMatch(/exist|account|known|attempt|expire/i);
  });

  it("does the same cryptographic work whether or not a challenge exists (timing-safe structure)", () => {
    const known = email(); requestCode(known, "x", Date.now());
    const spy = vi.spyOn(nodeCrypto, "createHmac");
    verifyCode(known, "000000", Date.now() + 1);
    const withRow = spy.mock.calls.length;
    spy.mockClear();
    verifyCode(email("ghost"), "000000", Date.now() + 1);
    expect(spy.mock.calls.length).toBe(withRow);
    expect(withRow).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------- email transports
describe("email transports", () => {
  it("console and memory transports are impossible in production", () => {
    const prod = { NODE_ENV: "production", MORPHIE_EMAIL_TRANSPORT: "console" } as unknown as NodeJS.ProcessEnv;
    expect(transportName(prod)).toBeUndefined();
    expect(() => createTransport(prod)).toThrow(/not configured|not allowed/);
    expect(transportName({ NODE_ENV: "production" } as never)).toBeUndefined();               // unset in production: email login simply off
    expect(transportName({ NODE_ENV: "production", MORPHIE_EMAIL_TRANSPORT: "memory" } as never)).toBeUndefined();
    expect(transportName({ NODE_ENV: "development" } as never)).toBe("console");               // dev default
    expect(transportName({ NODE_ENV: "development", MORPHIE_EMAIL_TRANSPORT: "memory" } as never)).toBeUndefined(); // memory is test-only
    expect(transportName({ NODE_ENV: "production", MORPHIE_EMAIL_TRANSPORT: "smtp", MORPHIE_SMTP_URL: "smtps://u:p@h:465" } as never)).toBe("smtp");
    expect(transportName({ NODE_ENV: "production", MORPHIE_EMAIL_TRANSPORT: "resend" } as never)).toBeUndefined(); // missing key
  });

  it("with email login off, the endpoints answer 404 and send nothing", async () => {
    vi.stubEnv("MORPHIE_EMAIL_TRANSPORT", "smtp"); vi.stubEnv("MORPHIE_SMTP_URL", "");
    expect((await ask(new Client(), email())).status).toBe(404);
    expect((await verify(new Client(), email(), "123456")).status).toBe(404);
  });

  it("SMTP builds the message and Resend calls the API with the key, without echoing error bodies", async () => {
    const mailer = nodemailer.createTransport({ jsonTransport: true });
    const sent = await mailer.sendMail({ from: "x", to: "y", subject: "s", text: "t" });
    expect(JSON.parse((sent as any).message).subject).toBe("s");
    const spy = vi.spyOn(mailer, "sendMail");
    await new SmtpTransport(mailer, "Morphie <no-reply@example.com>").send({ to: "ada@example.com", subject: "Hi", text: "Body" });
    expect(spy).toHaveBeenCalledWith({ from: "Morphie <no-reply@example.com>", to: "ada@example.com", subject: "Hi", text: "Body" });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok: FetchLike = async (url, init) => { calls.push({ url, init: init! }); return new Response("{}", { status: 200 }); };
    await new ResendTransport("re_key_123", "Morphie <no-reply@example.com>", ok as never).send({ to: "ada@example.com", subject: "Hi", text: "Body" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_key_123");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ to: ["ada@example.com"], subject: "Hi", text: "Body" });
    const fail: FetchLike = async () => new Response('{"message":"bad address ada@example.com"}', { status: 422 });
    await expect(new ResendTransport("k", "f", fail as never).send({ to: "ada@example.com", subject: "s", text: "t" })).rejects.toThrow(/HTTP 422\)/);
    await expect(new ResendTransport("k", "f", fail as never).send({ to: "ada@example.com", subject: "s", text: "t" })).rejects.not.toThrow(/ada@example\.com/);
  });
});

// ------------------------------------------------------------------------ OAuth
function fakeProvider(id: Provider) {
  const calls: Array<{ code: string; verifier: string; redirectUri: string }> = [];
  const state = { challenge: "", redirectUri: "", profile: { providerUserId: `${id}-sub-${++seq}`, email: email(id), name: "Fake Person" } as VerifiedProfile, fail: null as OAuthError | null };
  const p: OAuthProvider = {
    id,
    authorizationUrl: (a) => { state.challenge = a.challenge; state.redirectUri = a.redirectUri; return new URL(`https://fake-${id}.test/authorize?state=${a.state}&code_challenge=${a.challenge}&redirect_uri=${encodeURIComponent(a.redirectUri)}`); },
    exchange: async (a) => { calls.push(a); if (state.fail) throw state.fail; return state.profile; },
  };
  return { p, calls, state };
}
const start = (c: Client, provider: Provider, q = "") => c.call(oauthStart.GET, `/api/auth/oauth/${provider}/start${q}`, { params: { provider } });
const callback = (c: Client, provider: Provider, q: string) => c.call(oauthCallback.GET, `/api/auth/oauth/${provider}/callback?${q}`, { params: { provider } });
const stateOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state")!;

describe("OAuth: state, PKCE, redirect URI", () => {
  it("start redirects with state + PKCE, sets a short HttpOnly state cookie, and stores only a hash of the state", async () => {
    const g = fakeProvider("google"); setProviderOverrides({ google: g.p });
    const c = new Client(); const res = await start(c, "google", "?returnTo=/settings");
    expect(res.status).toBe(302);
    const state = stateOf(res);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^morphie_oauth=${state};.*Max-Age=600.*HttpOnly.*SameSite=Lax`));
    expect(JSON.stringify(db().prepare("SELECT * FROM oauth_states").all())).not.toContain(state);
    expect(n("SELECT COUNT(*) AS n FROM oauth_states WHERE state_hash = ?", sha256(state))).toBe(1);
    expect(g.state.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("completes a login: PKCE verifier matches the challenge, session is rotated, guest id is kept for the claim", async () => {
    const g = fakeProvider("google"); setProviderOverrides({ google: g.p });
    const c = new Client(); await c.call(bootstrap.GET, "/api/bootstrap");
    const guestToken = c.sessionToken!; const guestId = resolveSession(guestToken)!.actor.userId;
    const s = stateOf(await start(c, "google", "?returnTo=/settings?tab=account"));
    const res = await callback(c, "google", `code=abc&state=${s}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings?tab=account");
    expect(g.calls).toHaveLength(1);
    expect(pkceChallenge(g.calls[0].verifier)).toBe(g.state.challenge);
    expect(g.calls[0].redirectUri).toBe("http://localhost:3000/api/auth/oauth/google/callback");
    expect(resolveSession(guestToken)).toBeNull();
    const now = resolveSession(c.sessionToken!)!;
    expect(now.actor.isGuest).toBe(false); expect(now.user.email).toBe(g.state.profile.email);
    expect(now.linkedGuestUserId).toBe(guestId);
    expect(c.jar.has("morphie_oauth")).toBe(false); // the state cookie is single use
    expect((await c.json(sessionRoute.GET, "/api/auth/session")).data).toMatchObject({ authenticated: true, isGuest: false });
  });

  it("rejects a state mismatch, a missing cookie (another browser), a replay, and the wrong provider", async () => {
    const g = fakeProvider("google"), h = fakeProvider("github"); setProviderOverrides({ google: g.p, github: h.p });
    const users = n("SELECT COUNT(*) AS n FROM users WHERE is_guest = 0");
    // attacker lures the victim into finishing the attacker's login: state belongs to another browser
    const attacker = new Client(); const s = stateOf(await start(attacker, "google"));
    const victim = new Client();
    expect((await callback(victim, "google", `code=abc&state=${s}`)).headers.get("location")).toBe("/?auth_error=state_mismatch");
    // cookie present but state param differs
    const c = new Client(); await start(c, "google");
    expect((await callback(c, "google", "code=abc&state=" + "A".repeat(43))).headers.get("location")).toBe("/?auth_error=state_mismatch");
    // no state at all
    const d = new Client(); await start(d, "google");
    expect((await callback(d, "google", "code=abc")).headers.get("location")).toBe("/?auth_error=state_mismatch");
    // replay: the same callback twice
    const e = new Client(); const s2 = stateOf(await start(e, "google")); const cookie = e.cookieHeader;
    expect((await callback(e, "google", `code=abc&state=${s2}`)).headers.get("location")).toBe("/");
    const replayer = new Client(); replayer.jar.set("morphie_oauth", s2);
    expect((await callback(replayer, "google", `code=abc&state=${s2}`)).headers.get("location")).toBe("/?auth_error=state_mismatch");
    expect(cookie).toContain("morphie_oauth");
    // a state created for google cannot finish a github login
    const f = new Client(); const s3 = stateOf(await start(f, "google"));
    expect((await callback(f, "github", `code=abc&state=${s3}`)).headers.get("location")).toBe("/?auth_error=state_mismatch");
    expect(h.calls).toHaveLength(0);
    expect(g.calls).toHaveLength(1);                       // only the one legitimate completion ever reached the provider
    expect(n("SELECT COUNT(*) AS n FROM users WHERE is_guest = 0")).toBe(users + 1);
  });

  it("blocks login CSRF: a victim who has their OWN pending login can't be steered into the attacker's", async () => {
    const g = fakeProvider("google"); setProviderOverrides({ google: g.p });
    const attacker = new Client(); const attackerState = stateOf(await start(attacker, "google")); // attacker's valid, unused state
    const victim = new Client(); await start(victim, "google");                                    // victim has a legitimate cookie of their own
    expect(victim.jar.get("morphie_oauth")).not.toBe(attackerState);
    const res = await callback(victim, "google", `code=attackers-code&state=${attackerState}`);    // lured link carries the attacker's state
    expect(res.headers.get("location")).toBe("/?auth_error=state_mismatch");
    expect(g.calls).toHaveLength(0);
    expect(victim.sessionToken).toBeUndefined();
  });

  it("expires a pending login after 10 minutes", async () => {
    const g = fakeProvider("google"); setProviderOverrides({ google: g.p });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const c = new Client(); const s = stateOf(await start(c, "google"));
    vi.setSystemTime(new Date("2026-03-01T10:10:01Z"));
    expect((await callback(c, "google", `code=abc&state=${s}`)).headers.get("location")).toBe("/?auth_error=expired");
    expect(g.calls).toHaveLength(0);
  });

  it("treats a cancelled sign-in and provider failures as short error codes, never provider text", async () => {
    const g = fakeProvider("github"); setProviderOverrides({ github: g.p });
    const c = new Client(); await start(c, "github");
    expect((await callback(c, "github", "error=access_denied&error_description=secret+detail")).headers.get("location")).toBe("/?auth_error=denied");
    const d = new Client(); const s = stateOf(await start(d, "github"));
    g.state.fail = new OAuthError("provider_error", "boom with <secret>");
    const res = await callback(d, "github", `code=abc&state=${s}`);
    expect(res.headers.get("location")).toBe("/?auth_error=provider_error");
    expect(JSON.stringify([...res.headers])).not.toContain("secret");
  });

  it("only offers configured providers", async () => {
    expect((await start(new Client(), "google")).status).toBe(404);
    expect((await callback(new Client(), "github", "code=x&state=y")).status).toBe(404);
    expect((await start(new Client(), "facebook" as never)).status).toBe(404);
  });

  it("uses the exact redirect URI from MORPHIE_PUBLIC_URL and never the Host header", async () => {
    vi.stubEnv("MORPHIE_PUBLIC_URL", "https://morphie.example/"); vi.stubEnv("GOOGLE_CLIENT_ID", "gid"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "gsecret");
    const evil = new Client("http://localhost:3000", { host: "evil.example" });
    const res = await evil.call(oauthStart.GET, "/api/auth/oauth/google/start", { params: { provider: "google" }, origin: null });
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://morphie.example/api/auth/oauth/google/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("gid");
    expect(res.headers.get("location")).not.toContain("gsecret");
  });

  it("only same-site relative return paths survive", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\nSet-Cookie: x=1", "", null, undefined, "/" + "a".repeat(300)]) expect(safeReturnTo(bad as never)).toBe("/");
    expect(safeReturnTo("/settings?tab=account#x")).toBe("/settings?tab=account#x");
  });
});

const route = (table: Record<string, () => Response>, seen: Array<{ url: string; init?: RequestInit }> = []): FetchLike =>
  async (url, init) => { seen.push({ url, init }); const h = table[url]; if (!h) throw new Error("unexpected " + url); return h(); };

describe("OAuth provider adapters (mocked HTTP)", () => {
  const client = { id: "cid", secret: "csecret" };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  it("Google: sends the code, verifier, redirect URI and secret; accepts only email_verified", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const f = route({
      "https://oauth2.googleapis.com/token": () => json({ access_token: "at", token_type: "Bearer" }),
      "https://openidconnect.googleapis.com/v1/userinfo": () => json({ sub: "g-1", email: "Ada@Example.com", email_verified: true, name: "Ada" }),
    }, seen);
    const p = await googleProvider(client, f).exchange({ code: "the-code", verifier: "the-verifier", redirectUri: "https://m.example/cb" });
    expect(p).toEqual({ providerUserId: "g-1", email: "Ada@Example.com", name: "Ada" });
    const form = new URLSearchParams(seen[0].init!.body as string);
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: "authorization_code", code: "the-code", code_verifier: "the-verifier", redirect_uri: "https://m.example/cb", client_id: "cid", client_secret: "csecret" });
    expect((seen[1].init!.headers as Record<string, string>).authorization).toBe("Bearer at");

    for (const email_verified of [false, undefined, "false", 1]) {
      const bad = route({ "https://oauth2.googleapis.com/token": () => json({ access_token: "at" }), "https://openidconnect.googleapis.com/v1/userinfo": () => json({ sub: "g-2", email: "x@example.com", email_verified }) });
      await expect(googleProvider(client, bad).exchange({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toMatchObject({ code: "unverified_email" });
    }
  });

  it("GitHub: uses the verified PRIMARY address from /user/emails, never the public profile email", async () => {
    const mk = (emails: unknown, profileEmail = "public@example.com") => route({
      "https://github.com/login/oauth/access_token": () => json({ access_token: "gh-at", token_type: "bearer" }),
      "https://api.github.com/user": () => json({ id: 4242, login: "ada", name: null, email: profileEmail }),
      "https://api.github.com/user/emails": () => json(emails),
    });
    const ok = await githubProvider(client, mk([
      { email: "old@example.com", primary: false, verified: true }, { email: "me@example.com", primary: true, verified: true },
    ])).exchange({ code: "c", verifier: "v", redirectUri: "r" });
    expect(ok).toEqual({ providerUserId: "4242", email: "me@example.com", name: "ada" });
    for (const emails of [[{ email: "me@example.com", primary: true, verified: false }], [{ email: "x@example.com", primary: false, verified: true }], [], "nonsense"]) {
      await expect(githubProvider(client, mk(emails)).exchange({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toMatchObject({ code: "unverified_email" });
    }
    const u = githubProvider(client).authorizationUrl({ state: "s", challenge: "ch", redirectUri: "https://m.example/cb" });
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ scope: "user:email", code_challenge: "ch", code_challenge_method: "S256", state: "s", redirect_uri: "https://m.example/cb" });
  });

  it("maps provider failures to provider_error without leaking their text", async () => {
    const down = route({ "https://oauth2.googleapis.com/token": () => json({ error: "invalid_grant", error_description: "secret" }, 400) });
    await expect(googleProvider(client, down).exchange({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toMatchObject({ code: "provider_error", message: expect.not.stringContaining("secret") });
    const throwing: FetchLike = async () => { throw new Error("ECONNRESET secret.host"); };
    await expect(githubProvider(client, throwing).exchange({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toMatchObject({ code: "provider_error", message: expect.not.stringContaining("secret") });
  });
});

// ------------------------------------------------------------------------ linking
describe("account linking: one account per verified email", () => {
  it("email code, then Google, then GitHub with the same verified address: one account", async () => {
    const addr = email("one");
    const c = new Client(); await ask(c, addr); await verify(c, addr, lastCode(addr));
    const userId = resolveSession(c.sessionToken!)!.actor.userId;
    const g = loginWithProvider("google", { providerUserId: "g-1", email: addr.toUpperCase(), name: "Ada" });
    const h = loginWithProvider("github", { providerUserId: "h-1", email: addr, name: "ada" });
    expect(g.user.id).toBe(userId); expect(g.linked).toBe(true); expect(g.created).toBe(false);
    expect(h.user.id).toBe(userId);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE email = ?", addr)).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?", userId)).toBe(2);
  });

  it("OAuth first, then the email code: same account", async () => {
    const addr = email("two");
    const first = loginWithProvider("google", { providerUserId: "g-2", email: addr });
    expect(first.created).toBe(true);
    const c = new Client(); await ask(c, addr);
    expect((await verify(c, addr, lastCode(addr))).data.created).toBe(false);
    expect(resolveSession(c.sessionToken!)!.actor.userId).toBe(first.user.id);
  });

  it("a known provider identity wins over a changed email address", () => {
    const a = loginWithProvider("google", { providerUserId: "stable-id", email: email("old") });
    const b = loginWithProvider("google", { providerUserId: "stable-id", email: email("new") });
    expect(b.user.id).toBe(a.user.id);
    expect(b.user.email).toBe(a.user.email);
  });

  it("the same provider user id under different providers are different identities", () => {
    const a = loginWithProvider("google", { providerUserId: "12345", email: email("x") });
    const b = loginWithProvider("github", { providerUserId: "12345", email: email("y") });
    expect(a.user.id).not.toBe(b.user.id);
  });

  it("never links on an unverified email: an attacker who controls the provider address can't take over the account", async () => {
    const victim = email("victim");
    const c = new Client(); await ask(c, victim); await verify(c, victim, lastCode(victim));
    const victimId = resolveSession(c.sessionToken!)!.actor.userId;
    // the attacker's GitHub account claims the victim's address but it is NOT verified there
    const f: FetchLike = route({
      "https://github.com/login/oauth/access_token": () => new Response(JSON.stringify({ access_token: "t" })),
      "https://api.github.com/user": () => new Response(JSON.stringify({ id: 666, login: "mallory", email: victim })),
      "https://api.github.com/user/emails": () => new Response(JSON.stringify([{ email: victim, primary: true, verified: false }])),
    });
    await expect(githubProvider({ id: "i", secret: "s" }, f).exchange({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toMatchObject({ code: "unverified_email" });
    // and through the real callback: nothing is created or linked
    const identities = n("SELECT COUNT(*) AS n FROM user_identities");
    setProviderOverrides({ github: { id: "github", authorizationUrl: (a) => new URL(`https://x.test/?state=${a.state}`), exchange: async (a) => githubProvider({ id: "i", secret: "s" }, f).exchange(a) } });
    const m = new Client(); const s = stateOf(await start(m, "github"));
    expect((await callback(m, "github", `code=abc&state=${s}`)).headers.get("location")).toBe("/?auth_error=unverified_email");
    expect(m.sessionToken).toBeUndefined();
    expect(n("SELECT COUNT(*) AS n FROM user_identities")).toBe(identities);
    expect(n("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?", victimId)).toBe(0);
  });

  it("an unverified address can never create an account by itself (only proven emails exist in users)", async () => {
    const ghost = email("ghost"); await ask(new Client(), ghost);       // a code was requested, never proven
    expect(findUserByEmail(ghost)).toBeNull();
    expect(n("SELECT COUNT(*) AS n FROM users WHERE email IS NOT NULL AND email_verified_at IS NULL")).toBe(0);
  });
});

describe("login does not disturb other sessions or leak guest data", () => {
  it("the guest's conversations stay with the guest id until they are claimed (never exposed to the account by login alone)", async () => {
    const tab = new Client(); await tab.call(bootstrap.GET, "/api/bootstrap");
    const guestId = resolveSession(tab.sessionToken!)!.actor.userId;
    createConversation(testActor(guestId), "chat", "Guest chat");
    const addr = email(); await ask(tab, addr); await verify(tab, addr, lastCode(addr));
    expect((await tab.json(conversations.GET, "/api/conversations")).data.conversations).toEqual([]); // the account starts empty; claim is a separate step
    expect(n("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?", guestId)).toBe(1);
  });
});
