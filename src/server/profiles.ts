import { z } from "zod";
import type { ProfileView, ProviderKind, ProviderOptions } from "@/lib/types";
import { LIMITS } from "./config";
import { decrypt, encrypt, randomId } from "./crypto";
import { db, now, stmt } from "./db";
import type { ResolvedProfile } from "./providers/factory";
import { specFor } from "./providers/catalog";
import { ApiError } from "./http";

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "cookie"]);

const headerName = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, "Header names can only use letters, digits and dashes.");
const path = z.string().trim().max(200).regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/, "Paths must start with / and contain no spaces or ?.");

export const optionsSchema = z.object({
  authStyle: z.enum(["bearer", "x-api-key", "api-key", "header", "none"]).optional(),
  authHeaderName: headerName.optional(),
  extraHeaders: z.record(headerName, z.string().max(800)).optional(),
  queryParams: z.record(z.string().trim().min(1).max(64), z.string().max(400)).optional(),
  chatPath: path.optional(),
  modelsPath: path.optional(),
  streaming: z.boolean().optional(),
  nativeTools: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  tokenParam: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
  systemPrompt: z.string().max(4000).optional(),
  timeoutSec: z.number().int().min(5).max(600).optional(),
}).strict();

export function sanitizeOptions(raw: unknown): ProviderOptions {
  const parsed = optionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ApiError(400, `${i.path.join(".") || "options"}: ${i.message}`, "invalid");
  }
  const o = parsed.data;
  if (o.extraHeaders) {
    const entries = Object.entries(o.extraHeaders).filter(([k]) => !FORBIDDEN_HEADERS.has(k.toLowerCase()));
    if (entries.length > 12) throw new ApiError(400, "Use 12 or fewer extra headers.", "invalid");
    o.extraHeaders = Object.fromEntries(entries);
  }
  if (o.queryParams && Object.keys(o.queryParams).length > 8) throw new ApiError(400, "Use 8 or fewer query parameters.", "invalid");
  if (o.authStyle === "header" && !o.authHeaderName) throw new ApiError(400, "Enter the header name your provider expects for the key.", "invalid");
  for (const k of Object.keys(o) as Array<keyof ProviderOptions>) if (o[k] === undefined) delete o[k];
  return o;
}

interface Row {
  id: string; user_id: string; kind: string; label: string; model: string;
  secret_enc: string | null; base_url: string | null; options_enc: string | null; updated_at: number;
}

function readOptions(row: Row): ProviderOptions {
  if (!row.options_enc) return {};
  try { return JSON.parse(decrypt(row.options_enc)); } catch { return {}; }
}

function readKey(row: Row): string | undefined {
  if (!row.secret_enc) return undefined;
  try { return decrypt(row.secret_enc); } catch { return undefined; }
}

function view(row: Row): ProfileView {
  const key = readKey(row);
  const options = readOptions(row);
  // Header values may hold secrets; show names only.
  if (options.extraHeaders) options.extraHeaders = Object.fromEntries(Object.keys(options.extraHeaders).map((k) => [k, ""]));
  return {
    id: row.id, kind: row.kind as ProviderKind, label: row.label, model: row.model,
    baseUrl: row.base_url ?? undefined, hasKey: !!key, keyHint: key ? `••••${key.slice(-4)}` : undefined,
    options, updatedAt: row.updated_at,
  };
}

export async function listProfiles(userId: string): Promise<{ profiles: ProfileView[]; activeId: string | null }> {
  const rows = await db().all<Row>("SELECT * FROM provider_profiles WHERE user_id = ? ORDER BY updated_at DESC", userId);
  const active = await db().get<{ active_profile_id: string | null }>("SELECT active_profile_id FROM user_settings WHERE user_id = ?", userId);
  const activeId = rows.some((r) => r.id === active?.active_profile_id) ? active!.active_profile_id : null;
  return { profiles: rows.map(view), activeId };
}

export async function resolveProfile(userId: string, id: string): Promise<ResolvedProfile | null> {
  const row = await db().get<Row>("SELECT * FROM provider_profiles WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, label: row.label, model: row.model, apiKey: readKey(row),
    baseUrl: row.base_url ?? undefined, options: readOptions(row),
  };
}

export async function activeProfile(userId: string): Promise<ResolvedProfile | null> {
  const { activeId } = await listProfiles(userId);
  return activeId ? resolveProfile(userId, activeId) : null;
}

export interface SaveProfileInput {
  id?: string;
  kind: string;
  label?: string;
  model: string;
  apiKey?: string;
  clearKey?: boolean;
  baseUrl?: string;
  options?: ProviderOptions;
  activate?: boolean;
}

export async function saveProfile(userId: string, input: SaveProfileInput): Promise<ProfileView> {
  const spec = specFor(input.kind);
  if (!spec) throw new ApiError(400, "Unknown provider.", "invalid");
  const d = db();
  const existing = input.id
    ? await d.get<Row>("SELECT * FROM provider_profiles WHERE id = ? AND user_id = ?", input.id, userId)
    : undefined;
  if (input.id && !existing) throw new ApiError(404, "That provider no longer exists.", "not_found");
  if (!existing) {
    const count = Number((await d.get<{ c: number }>("SELECT COUNT(*) c FROM provider_profiles WHERE user_id = ?", userId))!.c);
    if (count >= LIMITS.maxProfiles) throw new ApiError(400, `You can save up to ${LIMITS.maxProfiles} providers. Delete one first.`, "limit");
  }
  const id = existing?.id ?? randomId(9);
  const label = (input.label?.trim() || spec.label).slice(0, 60);
  const model = input.model.trim().slice(0, 200);
  if (!model) throw new ApiError(400, "Choose a model.", "invalid");

  let secretEnc = existing?.secret_enc ?? null;
  if (input.clearKey) secretEnc = null;
  if (input.apiKey && input.apiKey.trim()) {
    const key = input.apiKey.trim();
    if (key.length > 500 || /\s/.test(key)) throw new ApiError(400, "That API key looks malformed (it has spaces or is too long).", "invalid");
    secretEnc = encrypt(key);
  }
  if (spec.requiresKey && !secretEnc) throw new ApiError(400, `${spec.label} needs an API key.`, "invalid");

  const baseUrl = spec.editableBaseUrl ? (input.baseUrl?.trim() || null) : null;
  if (spec.kind === "custom" && !baseUrl) throw new ApiError(400, "Enter the provider's base URL.", "invalid");

  // Keep previously saved header values whose inputs were left blank in the UI.
  const prevOptions = existing ? readOptions(existing) : {};
  const options = sanitizeOptions(input.options);
  if (options.extraHeaders && prevOptions.extraHeaders) {
    for (const [k, v] of Object.entries(options.extraHeaders)) if (v === "" && prevOptions.extraHeaders[k]) options.extraHeaders[k] = prevOptions.extraHeaders[k];
  }
  if (options.extraHeaders) options.extraHeaders = Object.fromEntries(Object.entries(options.extraHeaders).filter(([, v]) => v !== ""));

  const t = now();
  await d.run(`INSERT INTO provider_profiles (id, user_id, kind, label, model, secret_enc, base_url, options_enc, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET label=?4, model=?5, secret_enc=?6, base_url=?7, options_enc=?8, updated_at=?9`,
    id, userId, input.kind, label, model, secretEnc, baseUrl, encrypt(JSON.stringify(options)), t);

  if (input.activate !== false && (input.activate || !existing)) await setActive(userId, id);
  return (await listProfiles(userId)).profiles.find((p) => p.id === id)!;
}

export async function setActive(userId: string, id: string): Promise<void> {
  if (!(await resolveProfile(userId, id))) throw new ApiError(404, "That provider no longer exists.", "not_found");
  await db().run(`INSERT INTO user_settings (user_id, active_profile_id) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET active_profile_id = excluded.active_profile_id`, userId, id);
}

export async function deleteProfile(userId: string, id: string): Promise<void> {
  await db().batch([
    stmt("DELETE FROM provider_profiles WHERE id = ? AND user_id = ?", id, userId),
    stmt("UPDATE user_settings SET active_profile_id = NULL WHERE user_id = ? AND active_profile_id = ?", userId, id),
  ]);
}

export interface DraftInput {
  profileId?: string;
  kind?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  label?: string;
  options?: ProviderOptions;
}

/** Build a ResolvedProfile from unsaved form values, falling back to a saved profile for blank fields (e.g. the key). */
export async function resolveDraft(userId: string, d: DraftInput): Promise<ResolvedProfile> {
  const saved = d.profileId ? await resolveProfile(userId, d.profileId) : null;
  if (d.profileId && !saved) throw new ApiError(404, "That provider no longer exists.", "not_found");
  const kind = d.kind ?? saved?.kind;
  if (!kind || !specFor(kind)) throw new ApiError(400, "Unknown provider.", "invalid");
  const options = sanitizeOptions(d.options ?? saved?.options);
  if (saved?.options.extraHeaders && options.extraHeaders) {
    for (const [k, v] of Object.entries(options.extraHeaders)) if (v === "" && saved.options.extraHeaders[k]) options.extraHeaders[k] = saved.options.extraHeaders[k];
    options.extraHeaders = Object.fromEntries(Object.entries(options.extraHeaders).filter(([, v]) => v !== ""));
  }
  return {
    id: saved?.id ?? "draft", kind, label: d.label?.trim() || saved?.label || specFor(kind)!.label,
    model: (d.model ?? saved?.model ?? "").trim(), apiKey: d.apiKey?.trim() || saved?.apiKey,
    baseUrl: d.baseUrl?.trim() || saved?.baseUrl, options,
  };
}
