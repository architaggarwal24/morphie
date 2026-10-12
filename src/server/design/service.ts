/**
 * DesignService: glue between the Design Agent, per-project version history, persistence and the renderer.
 * Each user can keep several design projects. A project has a bounded (20) version history with a cursor;
 * version labels only ever increase. Every stored design is re-validated on load, and all changes to one
 * project are serialised so a slow edit and a click on Undo can't overwrite each other.
 */
import { zipSync, strToU8 } from "fflate";
import type { DesignState, DesignSummary, DesignThemeView, DesignVersionView } from "@/lib/types";
import { randomId } from "../crypto";
import type { Actor } from "../auth/actor";
import * as store from "../data/designs";
import { now } from "../db";
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

type DesignRow = store.DesignRow;

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
function getRow(actor: Actor, id: string): DesignRow {
  const row = store.getDesignRow(actor, id);
  if (!row) throw new DesignStateError("That design no longer exists.", 404);
  return row;
}

/** Versions oldest→newest, each design re-validated; ones that no longer validate are dropped. */
function loadVersions(actor: Actor, row: DesignRow): Array<{ version: number; design: Design; prompt: string; summary: string; createdAt: number }> {
  const rows = store.loadVersionRows(actor, row.id);
  const out = [];
  for (const r of rows) {
    try { out.push({ version: r.version, design: validateDesign(JSON.parse(r.json)), prompt: r.prompt, summary: r.summary, createdAt: r.created_at }); }
    catch (e) { if (!(e instanceof DesignValidationError) && !(e instanceof SyntaxError)) throw e; }
  }
  return out;
}

function stateOf(actor: Actor, id: string): DesignState {
  const row = getRow(actor, id);
  const versions = loadVersions(actor, row);
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

function currentDesign(actor: Actor, id: string): Design {
  return stateOf(actor, id).design as unknown as Design;
}

/** Add a version to a project (dropping any redo branch and, once full, the oldest). Returns false if identical. */
function push(actor: Actor, row: DesignRow, design: Design, summary: string, prompt: string): boolean {
  const versions = loadVersions(actor, row);
  const cur = versions.find((v) => v.version === row.cursor) ?? versions[versions.length - 1];
  if (cur && JSON.stringify(cur.design) === JSON.stringify(design)) return false;
  store.pushVersion(actor, row, {
    json: JSON.stringify(design), prompt: prompt.slice(0, 2000), summary, name: design.name.slice(0, 60),
    keepUpTo: cur?.version ?? 0, historyLimit: HISTORY_LIMIT, now: now(),
  });
  return true;
}

// ---- public API --------------------------------------------------------
const agent = new DesignAgent();

export function listDesigns(actor: Actor): DesignSummary[] {
  return store.listDesignRows(actor).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, version: r.cursor, versions: r.n }));
}

/** Throws a 404 unless this actor owns the design. Cheap: reads one row, renders nothing. */
export function requireDesign(actor: Actor, id: string): void {
  getRow(actor, id);
}

export function getDesign(actor: Actor, id: string): DesignState {
  return stateOf(actor, id);
}

export function catalog(): { themes: DesignThemeView[]; deviceWidths: typeof DEVICE_WIDTHS } {
  return { themes: THEME_LIST.map((t) => ({ id: t.id, name: t.name, description: t.description, colors: { ...t.colors } })), deviceWidths: DEVICE_WIDTHS };
}

export interface CommitResult { state: DesignState; changed: boolean; kind: DesignResult["kind"]; summary: string; notes: string[] }

function commit(actor: Actor, row: DesignRow | null, result: DesignResult, prompt: string): CommitResult {
  let id: string;
  let changed: boolean;
  if (!row) {
    id = randomId(9);
    store.insertDesign(actor, { id, name: result.design.name.slice(0, 60), now: now() });
    changed = push(actor, getRow(actor, id), result.design, result.summary, prompt);
  } else {
    id = row.id;
    changed = push(actor, row, result.design, result.summary, prompt);
  }
  const summary = changed ? result.summary : result.kind === "edit" && result.summary !== DEFAULT_EDIT_SUMMARY ? `${NO_CHANGE} ${result.summary}` : NO_CHANGE;
  return { state: stateOf(actor, id), changed, kind: result.kind, summary, notes: result.notes.slice(0, 5) };
}

/** One chat turn in Design: create a new project (designId = null) or edit an existing one. */
export async function handleMessage(actor: Actor, designId: string | null, text: string, provider: Provider, opts: { signal?: AbortSignal; onProgress?: (p: DesignProgress) => void } = {}): Promise<CommitResult> {
  return withLock(`${actor.userId}:${designId ?? "new"}`, async () => {
    const row = designId ? getRow(actor, designId) : null;
    const current = row ? currentDesign(actor, row.id) : null;
    const result = await agent.respond(text, current, provider, opts);
    return commit(actor, row, result, text);
  });
}

export function applyThemePreset(actor: Actor, designId: string, themeId: string): Promise<CommitResult> {
  const preset = getTheme(themeId);
  if (!preset) throw new DesignStateError("Unknown theme.", 400);
  return withLock(`${actor.userId}:${designId}`, () => {
    const row = getRow(actor, designId);
    return commit(actor, row, agent.applyPreset(currentDesign(actor, designId), preset.id), `Use the ${preset.name} theme`);
  });
}

function moveCursor(actor: Actor, id: string, pick: (versions: number[], at: number) => number | null, none: string): Promise<DesignState> {
  return withLock(`${actor.userId}:${id}`, () => {
    const row = getRow(actor, id);
    const versions = loadVersions(actor, row).map((v) => v.version);
    const at = Math.max(0, versions.indexOf(row.cursor));
    const target = pick(versions, at);
    if (target === null || target === row.cursor) throw new DesignStateError(none);
    store.setCursor(actor, id, target, now());
    return stateOf(actor, id);
  });
}

export const undo = (u: Actor, id: string) => moveCursor(u, id, (v, at) => (at > 0 ? v[at - 1] : null), "Nothing to undo.");
export const redo = (u: Actor, id: string) => moveCursor(u, id, (v, at) => (at < v.length - 1 ? v[at + 1] : null), "Nothing to redo.");
export const restoreVersion = (u: Actor, id: string, version: number) => moveCursor(u, id, (v) => (v.includes(version) ? version : null), "That version is no longer available.");

export function renameDesign(actor: Actor, id: string, name: string): Promise<DesignState> {
  return withLock(`${actor.userId}:${id}`, () => {
    const row = getRow(actor, id);
    const design = { ...currentDesign(actor, id), name };
    const valid = validateDesign(design);
    push(actor, row, valid, `Renamed to ${valid.name}.`, `Rename to ${name}`);
    return stateOf(actor, id);
  });
}

export function deleteDesign(actor: Actor, id: string): void {
  getRow(actor, id);
  store.deleteDesign(actor, id);
}

export function exportDesign(actor: Actor, id: string, fmt: string): { format: string; designName: string; files: ExportFile[] } {
  if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) throw new DesignStateError(`Unknown export format. Choose one of: ${EXPORT_FORMATS.join(", ")}.`, 400);
  const design = currentDesign(actor, id);
  return { format: fmt, designName: design.name, files: fmt === "html" ? exportHtml(design) : exportReact(design) };
}

export function exportZip(actor: Actor, id: string, fmt: string): { filename: string; bytes: Uint8Array } {
  const ex = exportDesign(actor, id, fmt);
  const root = `${slugify(ex.designName, "design")}-${fmt}`;
  const files: Record<string, Uint8Array> = {};
  for (const f of ex.files) files[`${root}/${f.path}`] = strToU8(f.content);
  return { filename: `${root}.zip`, bytes: zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }) };
}
