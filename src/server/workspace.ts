import fs from "node:fs";
import path from "node:path";
import type { Actor } from "./auth/actor";
import { config } from "./config";

const MAX_FILE = 200_000;
const MAX_FILES = 100;
const MAX_TOTAL = 5_000_000;
const MAX_DEPTH = 4;

export class WorkspaceError extends Error {}
/** The file does not exist in *this actor's* workspace (another user's files are indistinguishable from missing ones). */
export class WorkspaceNotFoundError extends WorkspaceError {}

export interface WorkspaceFile { path: string; size: number; modified: number }

function root(actor: Actor): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actor.userId)) throw new WorkspaceError("Invalid user.");
  const dir = path.join(config.dataDir, "workspace", actor.userId);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

/** Normalise a user/model supplied relative path, rejecting anything that could escape the sandbox. */
export function cleanPath(rel: string): string {
  if (typeof rel !== "string" || !rel.trim()) throw new WorkspaceError("A file path is required.");
  if (rel.length > 120 || /[\0\\]/.test(rel) || rel.startsWith("/")) throw new WorkspaceError("Use a short relative path like notes/plan.md.");
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length || parts.length > MAX_DEPTH) throw new WorkspaceError(`Paths can be at most ${MAX_DEPTH} folders deep.`);
  for (const p of parts) {
    if (p === ".." || p.startsWith(".") || !/^[A-Za-z0-9._-]{1,64}$/.test(p)) {
      throw new WorkspaceError("Path segments may only use letters, digits, dot, dash and underscore, and can't start with a dot.");
    }
  }
  return parts.join("/");
}

function resolve(actor: Actor, rel: string): string {
  const base = root(actor);
  const full = path.join(base, cleanPath(rel));
  if (!full.startsWith(base + path.sep)) throw new WorkspaceError("That path is outside the workspace.");
  // Refuse to traverse symlinks anywhere below the root.
  let cur = base;
  for (const seg of path.relative(base, full).split(path.sep)) {
    cur = path.join(cur, seg);
    try { if (fs.lstatSync(cur).isSymbolicLink()) throw new WorkspaceError("Symbolic links aren't allowed."); } catch (e) { if (e instanceof WorkspaceError) throw e; }
  }
  return full;
}

export function listFiles(actor: Actor): WorkspaceFile[] {
  const base = root(actor);
  const out: WorkspaceFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        const st = fs.statSync(full);
        out.push({ path: path.relative(base, full).split(path.sep).join("/"), size: st.size, modified: st.mtimeMs });
      }
    }
  };
  walk(base, 1);
  return out.sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES * 2);
}

export function readFile(actor: Actor, rel: string): string {
  const full = resolve(actor, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new WorkspaceNotFoundError(`No file at ${cleanPath(rel)}.`);
  return fs.readFileSync(full, "utf8");
}

export function writeFile(actor: Actor, rel: string, content: string): { path: string; size: number; created: boolean } {
  if (typeof content !== "string") throw new WorkspaceError("File content must be text.");
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_FILE) throw new WorkspaceError(`Files can be at most ${MAX_FILE / 1000} KB.`);
  const full = resolve(actor, rel);
  const existing = fs.existsSync(full);
  const files = listFiles(actor);
  if (!existing && files.length >= MAX_FILES) throw new WorkspaceError(`The workspace is limited to ${MAX_FILES} files.`);
  const total = files.reduce((n, f) => n + f.size, 0) - (existing ? fs.statSync(full).size : 0);
  if (total + bytes > MAX_TOTAL) throw new WorkspaceError("The workspace is full (5 MB). Delete some files first.");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return { path: cleanPath(rel), size: bytes, created: !existing };
}

export function deleteFile(actor: Actor, rel: string): void {
  const full = resolve(actor, rel);
  if (!fs.existsSync(full)) throw new WorkspaceNotFoundError(`No file at ${cleanPath(rel)}.`);
  fs.rmSync(full, { force: true });
}

export function clearWorkspace(actor: Actor): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actor.userId)) return;
  fs.rmSync(path.join(config.dataDir, "workspace", actor.userId), { recursive: true, force: true });
}
