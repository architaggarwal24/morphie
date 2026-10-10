/**
 * DesignService: glue between the Design Agent, per-project version history, persistence and the renderer.
 * Each user can keep several design projects. A project has a bounded (20) version history with a cursor;
 * version labels only ever increase. Every stored design is re-validated on load, and all changes to one
 * project are serialised so a slow edit and a click on Undo can't overwrite each other.
 */
import { zipSync, strToU8 } from "fflate";
import type { DesignState, DesignSummary, DesignThemeView, DesignVersionView } from "@/lib/types";
import { randomId } from "../crypto";
import { withLock } from "../coordinator";
import { db, now, stmt } from "../db";
import { ApiError } from "../http";
import type { Provider } from "../providers/types";
import { DesignAgent, type DesignProgress, type DesignResult } from "./agent";
import { DesignValidationError } from "./fields";
import { DEVICE_WIDTHS } from "./layouts";
import { exportHtml, exportReact, renderPreview, type ExportFile } from "./renderer";
import { slugify, validateDesign, type Design } from "./schema";
import { THEME_LIST, getTheme } from "./themes";

export const HISTORY_LIMIT = 20;
export const EXPORT_FORMATS = ["html", "react"] as const;
const NO_CHANGE = "That didn't change anything about the design.";
const DEFAULT_EDIT_SUMMARY = "Updated the design.";

export class DesignStateError extends ApiError {
  constructor(message: string, status = 409) { super(status, message, "design_state"); }
}

interface DesignRow { id: string; user_id: string; name: string; cursor: number; next_version: number; revision: number; created_at: number; updated_at: number }
interface VersionRow { version: number; json: string; prompt: string; summary: string; created_at: number }

// ---- per-project mutex --------------------------------------------------
// Workers run many isolates, so the lock lives in the user's Coordinator Durable Object (FIFO, with a TTL).
// The key is `design:<id or "new">`; the lock is already scoped to the user by the object it lives in.
const locked = <T>(userId: string, key: string, fn: () => Promise<T> | T): Promise<T> =>
  withLock(userId, `design:${key}`, fn, { ttlMs: 5 * 60_000, waitMs: 5 * 60_000 });

// ---- storage -----------------------------------------------------------
async function getRow(userId: string, id: string): Promise<DesignRow> {
  const row = await db().get<DesignRow>("SELECT * FROM designs WHERE id = ? AND user_id = ?", id, userId);
  if (!row) throw new DesignStateError("That design no longer exists.", 404);
  return row;
}

/** Versions oldest→newest, each design re-validated; ones that no longer validate are dropped. */
async function loadVersions(row: DesignRow): Promise<Array<{ version: number; design: Design; prompt: string; summary: string; createdAt: number }>> {
  const rows = await db().all<VersionRow>("SELECT version, json, prompt, summary, created_at FROM design_versions WHERE design_id = ? ORDER BY version ASC", row.id);
  const out = [];
  for (const r of rows) {
    try { out.push({ version: r.version, design: validateDesign(JSON.parse(r.json)), prompt: r.prompt, summary: r.summary, createdAt: r.created_at }); }
    catch (e) { if (!(e instanceof DesignValidationError) && !(e instanceof SyntaxError)) throw e; }
  }
  return out;
}

async function stateOf(userId: string, id: string): Promise<DesignState> {
  const row = await getRow(userId, id);
  const versions = await loadVersions(row);
  if (!versions.length) throw new DesignStateError("That design has no readable versions.", 404);
  let idx = versions.findIndex((v) => v.version === row.cursor);
  if (idx < 0) idx = versions.length - 1;
  const cur = versions[idx];
  return {
    id: row.id, name: cur.design.name, design: cur.design as unknown as DesignState["design"], previewHtml: renderPreview(cur.design), updatedAt: row.updated_at,
    history: { version: cur.version, position: idx + 1, total: versions.length, canUndo: idx > 0, canRedo: idx < versions.length - 1, revision: row.revision },
    versions: versions.map((v, i): DesignVersionView => ({ version: v.version, summary: v.summary, prompt: v.prompt, createdAt: v.createdAt, current: i === idx })).reverse(),
  };
}

async function currentDesign(userId: string, id: string): Promise<Design> {
  return (await stateOf(userId, id)).design as unknown as Design;
}

/** Add a version to a project (dropping any redo branch and, once full, the oldest). Returns false if identical. */
async function push(row: DesignRow, design: Design, summary: string, prompt: string): Promise<boolean> {
  const versions = await loadVersions(row);
  const cur = versions.find((v) => v.version === row.cursor) ?? versions[versions.length - 1];
  if (cur && JSON.stringify(cur.design) === JSON.stringify(design)) return false;
  const t = now();
  await db().batch([
    stmt("DELETE FROM design_versions WHERE design_id = ? AND version > ?", row.id, cur?.version ?? 0),
    stmt("INSERT INTO design_versions (design_id, version, json, prompt, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      row.id, row.next_version, JSON.stringify(design), prompt.slice(0, 2000), summary, t),
    stmt(`DELETE FROM design_versions WHERE design_id = ? AND version <= (
        SELECT version FROM design_versions WHERE design_id = ? ORDER BY version DESC LIMIT 1 OFFSET ?)`, row.id, row.id, HISTORY_LIMIT),
    stmt("UPDATE designs SET cursor = ?, next_version = ?, revision = revision + 1, name = ?, updated_at = ? WHERE id = ?",
      row.next_version, row.next_version + 1, design.name.slice(0, 60), t, row.id),
  ]);
  return true;
}

// ---- public API --------------------------------------------------------
const agent = new DesignAgent();

export async function listDesigns(userId: string): Promise<DesignSummary[]> {
  const rows = await db().all<DesignRow & { n: number }>(`SELECT d.*, (SELECT COUNT(*) FROM design_versions v WHERE v.design_id = d.id) AS n FROM designs d WHERE d.user_id = ? ORDER BY d.updated_at DESC`, userId);
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, version: r.cursor, versions: r.n }));
}

export function getDesign(userId: string, id: string): Promise<DesignState> {
  return stateOf(userId, id);
}

export function catalog(): { themes: DesignThemeView[]; deviceWidths: typeof DEVICE_WIDTHS } {
  return { themes: THEME_LIST.map((t) => ({ id: t.id, name: t.name, description: t.description, colors: { ...t.colors } })), deviceWidths: DEVICE_WIDTHS };
}

export interface CommitResult { state: DesignState; changed: boolean; kind: DesignResult["kind"]; summary: string; notes: string[] }

async function commit(userId: string, row: DesignRow | null, result: DesignResult, prompt: string): Promise<CommitResult> {
  let id: string;
  let changed: boolean;
  if (!row) {
    id = randomId(9);
    const t = now();
    await db().run("INSERT INTO designs (id, user_id, name, cursor, next_version, revision, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 0, ?, ?)", id, userId, result.design.name.slice(0, 60), t, t);
    changed = await push(await getRow(userId, id), result.design, result.summary, prompt);
  } else {
    id = row.id;
    changed = await push(row, result.design, result.summary, prompt);
  }
  const summary = changed ? result.summary : result.kind === "edit" && result.summary !== DEFAULT_EDIT_SUMMARY ? `${NO_CHANGE} ${result.summary}` : NO_CHANGE;
  return { state: await stateOf(userId, id), changed, kind: result.kind, summary, notes: result.notes.slice(0, 5) };
}

/** One chat turn in Design: create a new project (designId = null) or edit an existing one. */
export async function handleMessage(userId: string, designId: string | null, text: string, provider: Provider, opts: { signal?: AbortSignal; onProgress?: (p: DesignProgress) => void } = {}): Promise<CommitResult> {
  return locked(userId, designId ?? "new", async () => {
    const row = designId ? await getRow(userId, designId) : null;
    const current = row ? await currentDesign(userId, row.id) : null;
    const result = await agent.respond(text, current, provider, opts);
    return commit(userId, row, result, text);
  });
}

export function applyThemePreset(userId: string, designId: string, themeId: string): Promise<CommitResult> {
  const preset = getTheme(themeId);
  if (!preset) throw new DesignStateError("Unknown theme.", 400);
  return locked(userId, designId, async () => {
    const row = await getRow(userId, designId);
    return commit(userId, row, agent.applyPreset(await currentDesign(userId, designId), preset.id), `Use the ${preset.name} theme`);
  });
}

function moveCursor(userId: string, id: string, pick: (versions: number[], at: number) => number | null, none: string): Promise<DesignState> {
  return locked(userId, id, async () => {
    const row = await getRow(userId, id);
    const versions = (await loadVersions(row)).map((v) => v.version);
    const at = Math.max(0, versions.indexOf(row.cursor));
    const target = pick(versions, at);
    if (target === null || target === row.cursor) throw new DesignStateError(none);
    await db().run("UPDATE designs SET cursor = ?, revision = revision + 1, updated_at = ? WHERE id = ?", target, now(), id);
    return stateOf(userId, id);
  });
}

export const undo = (u: string, id: string) => moveCursor(u, id, (v, at) => (at > 0 ? v[at - 1] : null), "Nothing to undo.");
export const redo = (u: string, id: string) => moveCursor(u, id, (v, at) => (at < v.length - 1 ? v[at + 1] : null), "Nothing to redo.");
export const restoreVersion = (u: string, id: string, version: number) => moveCursor(u, id, (v) => (v.includes(version) ? version : null), "That version is no longer available.");

export function renameDesign(userId: string, id: string, name: string): Promise<DesignState> {
  return locked(userId, id, async () => {
    const row = await getRow(userId, id);
    const design = { ...(await currentDesign(userId, id)), name };
    const valid = validateDesign(design);
    await push(row, valid, `Renamed to ${valid.name}.`, `Rename to ${name}`);
    return stateOf(userId, id);
  });
}

export async function deleteDesign(userId: string, id: string): Promise<void> {
  await getRow(userId, id);
  await db().batch([
    stmt("DELETE FROM design_versions WHERE design_id = ?", id),
    stmt("DELETE FROM designs WHERE id = ? AND user_id = ?", id, userId),
  ]);
}

export async function exportDesign(userId: string, id: string, fmt: string): Promise<{ format: string; designName: string; files: ExportFile[] }> {
  if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) throw new DesignStateError(`Unknown export format. Choose one of: ${EXPORT_FORMATS.join(", ")}.`, 400);
  const design = await currentDesign(userId, id);
  return { format: fmt, designName: design.name, files: fmt === "html" ? exportHtml(design) : exportReact(design) };
}

export async function exportZip(userId: string, id: string, fmt: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const ex = await exportDesign(userId, id, fmt);
  const root = `${slugify(ex.designName, "design")}-${fmt}`;
  const files: Record<string, Uint8Array> = {};
  for (const f of ex.files) files[`${root}/${f.path}`] = strToU8(f.content);
  return { filename: `${root}.zip`, bytes: zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }) };
}
