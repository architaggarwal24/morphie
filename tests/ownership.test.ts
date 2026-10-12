import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import * as bootstrap from "@/app/api/bootstrap/route";
import { _resetRateLimits } from "@/server/security";
import { Client } from "./helpers/client";
import { CASES, EXEMPT, actorOf, seedResources, snapshot, type Case, type Resources } from "./helpers/ownership";
import { makeUser, signIn } from "./helpers/users";

const API = path.resolve("src/app/api");
const VERBS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

function discover(dir = API, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) discover(f, out); else if (e.name === "route.ts") out.push(f);
  }
  return out.sort();
}
const patternOf = (file: string) => "/api/" + path.relative(API, path.dirname(file)).split(path.sep).filter(Boolean).join("/");
const routePattern = (file: string) => patternOf(file).replace(/\/$/, "");

const files = discover();
const modules = new Map<string, Record<string, any>>();
beforeAll(async () => { for (const f of files) modules.set(routePattern(f), await import(/* @vite-ignore */ f)); });
beforeEach(() => _resetRateLimits());

describe("every route declares who may call it", () => {
  it("discovers the route files", () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  it("every exported HTTP handler is built by route() with an auth level of public, guest or user", () => {
    const problems: string[] = [];
    for (const [pattern, mod] of modules) {
      const exported = VERBS.filter((v) => v in mod);
      if (!exported.length) problems.push(`${pattern}: exports no HTTP handler`);
      for (const v of exported) {
        const auth = mod[v]?.auth;
        if (!["public", "guest", "user"].includes(auth)) problems.push(`${pattern} ${v}: no auth declaration (wrap it in route({ auth: ... }, ...))`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("no route or page code touches the database directly", () => {
    const offenders: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name)) { const src = fs.readFileSync(f, "utf8"); if (/\bdb\(\)|from "@\/server\/db"|from "\.\.?\/.*\/server\/db"/.test(src)) offenders.push(f); } } };
    walk("src/app");
    expect(offenders).toEqual([]);
  });
});

describe("every route that takes an id or a path is covered by a cross-user case", () => {
  const needsCase = (file: string) => {
    const src = fs.readFileSync(file, "utf8");
    return routePattern(file).includes("[") || /\b(conversationId|designId|profileId)\b|searchParams\.get\("path"\)|\bid: z\.string/.test(src);
  };

  it("has a case or a documented exemption for each, and no stale entries", () => {
    const patterns = files.map(routePattern);
    const missing = files.filter(needsCase).map(routePattern).filter((p) => !CASES.some((c) => c.route === p) && !(p in EXEMPT));
    expect(missing, "routes taking ids/paths need a case in tests/helpers/ownership.ts (or an EXEMPT reason)").toEqual([]);
    expect(CASES.filter((c) => !patterns.includes(c.route)).map((c) => c.route)).toEqual([]);
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20);
  });

  it("covers every exported verb of those routes", () => {
    const gaps: string[] = [];
    for (const f of files.filter(needsCase)) {
      const p = routePattern(f);
      if (p in EXEMPT) continue;
      for (const v of VERBS.filter((v) => v in modules.get(p)!)) if (!CASES.some((c) => c.route === p && c.verb === v)) gaps.push(`${p} ${v}`);
    }
    expect(gaps).toEqual([]);
  });
});

async function guestClient(): Promise<Client> { const c = new Client(); await c.call(bootstrap.GET, "/api/bootstrap"); return c; }
const send = (c: Client, k: Case, r: Resources) =>
  c.json(modules.get(k.route)![k.verb], k.url(r), { method: k.verb, body: k.body?.(r), params: k.params?.(r) });

describe("user B can never reach user A's resources", () => {
  let victim: Client; let r: Resources; let before: string;
  beforeAll(async () => { victim = await guestClient(); r = await seedResources(victim); before = await snapshot(actorOf(victim)); });

  const attackers: Array<[string, () => Promise<Client>]> = [
    ["another guest", guestClient],
    ["a signed-in account", async () => { const c = new Client(); signIn(c, makeUser().userId); return c; }],
    ["a brand-new visitor with no cookie (becomes a guest)", async () => new Client()],
  ];

  for (const [who, make] of attackers) {
    describe(`as ${who}`, () => {
      for (const k of CASES) {
        it(`${k.verb} ${k.route}: ${k.label} → ${k.listing ? "200, nothing of A's" : "404/403"}`, async () => {
          const attacker = await make();
          const res = await send(attacker, k, r);
          if (k.listing) expect(res.status).toBe(200);
          else expect([403, 404], `${k.verb} ${k.url(r)} answered ${res.status} ${JSON.stringify(res.data)}`).toContain(res.status);
          expect(JSON.stringify(res.data ?? "")).not.toMatch(/Victim|victim|confidential roadmap|sk-victim|private (question|answer)/);
        });
      }
      it("leaves every one of A's resources exactly as they were", async () => {
        expect(await snapshot(actorOf(victim))).toBe(before);
      });
    });
  }
});

describe("positive controls: the same requests work (or reach the handler) for the real owner", () => {
  for (const k of CASES) {
    it(`${k.verb} ${k.route}: ${k.label}`, async () => {
      const owner = await guestClient();
      const r = await seedResources(owner);
      const res = await send(owner, k, r);
      if (k.owner === "reaches-handler") expect([403, 404], `${k.label}: ${JSON.stringify(res.data)}`).not.toContain(res.status);
      else expect(k.owner ?? [200], `${k.label}: ${JSON.stringify(res.data)}`).toContain(res.status);
    });
  }
});
