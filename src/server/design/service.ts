/**
 * DesignService: glue between the Design Agent, per-project version history, persistence and the renderer.
 * Each user can keep several design projects. A project has a bounded (20) version history with a cursor;
 * version labels only ever increase. Every stored design is re-validated on load, and all changes to one
 * project are serialised so a slow edit and a click on Undo can't overwrite each other.
 */
import { zipSync, strToU8 } from "fflate";
import type { DesignState, DesignSummary, DesignThemeView, DesignVersionView } from "@/lib/types";
import { randomId } from "../crypto";
import { db, now } from "../db";
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
const g = globalThis as unknown as { __morphieDesignLocks?: Map<string, Promise<unknown>> };
const locks = (g.__morphieDesignLocks ??= new Map());
async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  try { return await run; } finally { if (locks.get(key) === tail) locks.delete(key); }
}

// ---- storage -----------------------------------------------------------
function getRow(userId: string, id: string): DesignRow {
  const row = db().prepare("SELECT * FROM designs WHERE id = ? AND user_id = ?").get(id, userId) as DesignRow | undefined;
  if (!row) throw new DesignStateError("That design no longer exists.", 404);
  return row;
}

/** Versions oldest→newest, each design re-validated; ones that no longer validate are dropped. */
function loadVersions(row: DesignRow): Array<{ version: number; design: Design; prompt: string; summary: string; createdAt: number }> {
  const rows = db().prepare("SELECT version, json, prompt, summary, created_at FROM design_versions WHERE design_id = ? ORDER BY version ASC").all(row.id) as VersionRow[];
  const out = [];
  for (const r of rows) {
    try { out.push({ version: r.version, design: validateDesign(JSON.parse(r.json)), prompt: r.prompt, summary: r.summary, createdAt: r.created_at }); }
    catch (e) { if (!(e instanceof DesignValidationError) && !(e instanceof SyntaxError)) throw e; }
  }
  return out;
}

function stateOf(userId: string, id: string): DesignState {
  const row = getRow(userId, id);
  const versions = loadVersions(row);
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

function currentDesign(userId: string, id: string): Design {
  return stateOf(userId, id).design as unknown as Design;
}

/** Add a version to a project (dropping any redo branch and, once full, the oldest). Returns false if identical. */
function push(row: DesignRow, design: Design, summary: string, prompt: string): boolean {
  const d = db();
  const versions = loadVersions(row);
  const cur = versions.find((v) => v.version === row.cursor) ?? versions[versions.length - 1];
  if (cur && JSON.stringify(cur.design) === JSON.stringify(design)) return false;
  const t = now();
  d.transaction(() => {
    d.prepare("DELETE FROM design_versions WHERE design_id = ? AND version > ?").run(row.id, cur?.version ?? 0);
    d.prepare("INSERT INTO design_versions (design_id, version, json, prompt, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.next_version, JSON.stringify(design), prompt.slice(0, 2000), summary, t);
    d.prepare(`DELETE FROM design_versions WHERE design_id = ? AND version <= (
        SELECT version FROM design_versions WHERE design_id = ? ORDER BY version DESC LIMIT 1 OFFSET ?)`).run(row.id, row.id, HISTORY_LIMIT);
    d.prepare("UPDATE designs SET cursor = ?, next_version = ?, revision = revision + 1, name = ?, updated_at = ? WHERE id = ?")
      .run(row.next_version, row.next_version + 1, design.name.slice(0, 60), t, row.id);
  })();
  return true;
}

// ---- public API --------------------------------------------------------
const agent = new DesignAgent();

export function listDesigns(userId: string): DesignSummary[] {
  const rows = db().prepare(`SELECT d.*, (SELECT COUNT(*) FROM design_versions v WHERE v.design_id = d.id) AS n FROM designs d WHERE d.user_id = ? ORDER BY d.updated_at DESC`).all(userId) as Array<DesignRow & { n: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, version: r.cursor, versions: r.n }));
}

export function getDesign(userId: string, id: string): DesignState {
  return stateOf(userId, id);
}

export function catalog(): { themes: DesignThemeView[]; deviceWidths: typeof DEVICE_WIDTHS } {
  return { themes: THEME_LIST.map((t) => ({ id: t.id, name: t.name, description: t.description, colors: { ...t.colors } })), deviceWidths: DEVICE_WIDTHS };
}

export interface CommitResult { state: DesignState; changed: boolean; kind: DesignResult["kind"]; summary: string; notes: string[] }

function commit(userId: string, row: DesignRow | null, result: DesignResult, prompt: string): CommitResult {
  let id: string;
  let changed: boolean;
  if (!row) {
    id = randomId(9);
    const t = now();
    db().prepare("INSERT INTO designs (id, user_id, name, cursor, next_version, revision, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 0, ?, ?)").run(id, userId, result.design.name.slice(0, 60), t, t);
    changed = push(getRow(userId, id), result.design, result.summary, prompt);
  } else {
    id = row.id;
    changed = push(row, result.design, result.summary, prompt);
  }
  const summary = changed ? result.summary : result.kind === "edit" && result.summary !== DEFAULT_EDIT_SUMMARY ? `${NO_CHANGE} ${result.summary}` : NO_CHANGE;
  return { state: stateOf(userId, id), changed, kind: result.kind, summary, notes: result.notes.slice(0, 5) };
}

/** One chat turn in Design: create a new project (designId = null) or edit an existing one. */
export async function handleMessage(userId: string, designId: string | null, text: string, provider: Provider, opts: { signal?: AbortSignal; onProgress?: (p: DesignProgress) => void } = {}): Promise<CommitResult> {
  return withLock(`${userId}:${designId ?? "new"}`, async () => {
    const row = designId ? getRow(userId, designId) : null;
    const current = row ? currentDesign(userId, row.id) : null;
    const result = await agent.respond(text, current, provider, opts);
    return commit(userId, row, result, text);
  });
}

export function applyThemePreset(userId: string, designId: string, themeId: string): Promise<CommitResult> {
  const preset = getTheme(themeId);
  if (!preset) throw new DesignStateError("Unknown theme.", 400);
  return withLock(`${userId}:${designId}`, () => {
    const row = getRow(userId, designId);
    return commit(userId, row, agent.applyPreset(currentDesign(userId, designId), preset.id), `Use the ${preset.name} theme`);
  });
}

function moveCursor(userId: string, id: string, pick: (versions: number[], at: number) => number | null, none: string): Promise<DesignState> {
  return withLock(`${userId}:${id}`, () => {
    const row = getRow(userId, id);
    const versions = loadVersions(row).map((v) => v.version);
    const at = Math.max(0, versions.indexOf(row.cursor));
    const target = pick(versions, at);
    if (target === null || target === row.cursor) throw new DesignStateError(none);
    db().prepare("UPDATE designs SET cursor = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(target, now(), id);
    return stateOf(userId, id);
  });
}

export const undo = (u: string, id: string) => moveCursor(u, id, (v, at) => (at > 0 ? v[at - 1] : null), "Nothing to undo.");
export const redo = (u: string, id: string) => moveCursor(u, id, (v, at) => (at < v.length - 1 ? v[at + 1] : null), "Nothing to redo.");
export const restoreVersion = (u: string, id: string, version: number) => moveCursor(u, id, (v) => (v.includes(version) ? version : null), "That version is no longer available.");

export function renameDesign(userId: string, id: string, name: string): Promise<DesignState> {
  return withLock(`${userId}:${id}`, () => {
    const row = getRow(userId, id);
    const design = { ...currentDesign(userId, id), name };
    const valid = validateDesign(design);
    push(row, valid, `Renamed to ${valid.name}.`, `Rename to ${name}`);
    return stateOf(userId, id);
  });
}

export function deleteDesign(userId: string, id: string): void {
  getRow(userId, id);
  db().prepare("DELETE FROM design_versions WHERE design_id = ?").run(id);
  db().prepare("DELETE FROM designs WHERE id = ? AND user_id = ?").run(id, userId);
}

export function exportDesign(userId: string, id: string, fmt: string): { format: string; designName: string; files: ExportFile[] } {
  if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) throw new DesignStateError(`Unknown export format. Choose one of: ${EXPORT_FORMATS.join(", ")}.`, 400);
  const design = currentDesign(userId, id);
  return { format: fmt, designName: design.name, files: fmt === "html" ? exportHtml(design) : exportReact(design) };
}

export function exportZip(userId: string, id: string, fmt: string): { filename: string; bytes: Uint8Array } {
  const ex = exportDesign(userId, id, fmt);
  const root = `${slugify(ex.designName, "design")}-${fmt}`;
  const files: Record<string, Uint8Array> = {};
  for (const f of ex.files) files[`${root}/${f.path}`] = strToU8(f.content);
  return { filename: `${root}.zip`, bytes: zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }) };
}
