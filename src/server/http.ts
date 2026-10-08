import { z, ZodType } from "zod";
import { randomId, sign, verifySig } from "./crypto";
import { touchUser } from "./db";
import { checkOrigin, OriginError, rateLimit, SecurityError } from "./security";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  userId: string;
  /** Dynamic path segments, e.g. { id } for /api/things/[id]. */
  params: Record<string, string>;
  /** Parse and validate the JSON body. */
  body<T>(schema: ZodType<T>, maxBytes?: number): Promise<T>;
}

export interface RouteOptions {
  rate?: { bucket: string; limit: number; windowMs: number };
}

const COOKIE = "morphie_uid";

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Signed anonymous session: "<id>.<sig>". Returns the id and, if new, the Set-Cookie header. */
export function resolveSession(req: Request): { userId: string; setCookie?: string } {
  const raw = readCookie(req, COOKIE);
  if (raw) {
    const dot = raw.lastIndexOf(".");
    if (dot > 0) {
      const id = raw.slice(0, dot);
      if (/^[A-Za-z0-9_-]{16,64}$/.test(id) && verifySig(id, raw.slice(dot + 1))) return { userId: id };
    }
  }
  const id = randomId(18);
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = `${COOKIE}=${id}.${sign(id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
  return { userId: id, setCookie: cookie };
}

function jsonError(status: number, message: string, code: string, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

/**
 * Wraps a route handler with: session, CSRF check, rate limiting, body validation,
 * uniform JSON errors and no-store caching. Handlers may return a Response or any JSON value.
 */
export function route(handler: (ctx: Ctx) => Promise<unknown>, opts: RouteOptions = {}) {
  return async (req: Request, routeCtx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const { userId, setCookie } = resolveSession(req);
    const params = (await routeCtx?.params) ?? {};
    const extra = setCookie ? { "set-cookie": setCookie } : undefined;
    try {
      checkOrigin(req);
      if (opts.rate) {
        const wait = rateLimit(`${opts.rate.bucket}:${userId}`, opts.rate.limit, opts.rate.windowMs);
        if (wait) return jsonError(429, `Slow down — try again in ${wait}s.`, "rate_limited", { ...extra, "retry-after": String(wait) });
      }
      touchUser(userId);
      const ctx: Ctx = {
        req,
        url: new URL(req.url),
        userId,
        params,
        async body<T>(schema: ZodType<T>, maxBytes = 1_000_000) {
          const text = await req.text();
          if (text.length > maxBytes) throw new ApiError(413, "That request is too large.", "too_large");
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            throw new ApiError(400, "The request body isn't valid JSON.", "bad_json");
          }
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            const first = parsed.error.issues[0];
            const where = first?.path.length ? `${first.path.join(".")}: ` : "";
            throw new ApiError(400, `${where}${first?.message ?? "Invalid request."}`, "invalid");
          }
          return parsed.data;
        },
      };
      const result = await handler(ctx);
      if (result instanceof Response) {
        if (setCookie) result.headers.append("set-cookie", setCookie);
        if (!result.headers.has("cache-control")) result.headers.set("cache-control", "no-store");
        return result;
      }
      return new Response(JSON.stringify(result ?? { ok: true }), {
        headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
      });
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.status, err.message, err.code, extra);
      if (err instanceof OriginError) return jsonError(403, err.message, "forbidden", extra);
      if (err instanceof SecurityError) return jsonError(400, err.message, "invalid", extra);
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return jsonError(500, "Something went wrong on the server.", "internal", extra);
    }
  };
}

export { z };
