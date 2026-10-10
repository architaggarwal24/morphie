import { db, now } from "./db";

/**
 * The agent's private "folder", stored as rows in D1 (table workspace_files) instead of a directory on disk.
 * A Worker has no writable filesystem, and rows scoped by user_id give the same isolation guarantee the old
 * per-user directory did. Path rules are unchanged, so nothing can escape the sandbox: there is no filesystem.
 */
const MAX_FILE = 200_000;
const MAX_FILES = 100;
const MAX_TOTAL = 5_000_000;
const MAX_DEPTH = 4;

export class WorkspaceError extends Error {}

export interface WorkspaceFile { path: string; size: number; modified: number }

function checkUser(userId: string): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(userId)) throw new WorkspaceError("Invalid user.");
}

/** Normalise a user/model supplied relative path, rejecting anything odd. */
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

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export async function listFiles(userId: string): Promise<WorkspaceFile[]> {
  checkUser(userId);
  const rows = await db().all<{ path: string; size: number; modified: number }>(
    "SELECT path, size, modified FROM workspace_files WHERE user_id = ? ORDER BY path ASC LIMIT ?", userId, MAX_FILES * 2);
  return rows.map((r) => ({ path: r.path, size: Number(r.size), modified: Number(r.modified) }));
}

/** Every file with its content in one query (zip download, data export). */
export async function readAllFiles(userId: string): Promise<Array<{ path: string; content: string }>> {
  checkUser(userId);
  return db().all<{ path: string; content: string }>("SELECT path, content FROM workspace_files WHERE user_id = ? ORDER BY path ASC LIMIT ?", userId, MAX_FILES * 2);
}

export async function readFile(userId: string, rel: string): Promise<string> {
  checkUser(userId);
  const path = cleanPath(rel);
  const row = await db().get<{ content: string }>("SELECT content FROM workspace_files WHERE user_id = ? AND path = ?", userId, path);
  if (!row) throw new WorkspaceError(`No file at ${path}.`);
  return row.content;
}

export async function writeFile(userId: string, rel: string, content: string): Promise<{ path: string; size: number; created: boolean }> {
  checkUser(userId);
  if (typeof content !== "string") throw new WorkspaceError("File content must be text.");
  const bytes = byteLength(content);
  if (bytes > MAX_FILE) throw new WorkspaceError(`Files can be at most ${MAX_FILE / 1000} KB.`);
  const path = cleanPath(rel);
  const d = db();
  const existing = await d.get<{ size: number }>("SELECT size FROM workspace_files WHERE user_id = ? AND path = ?", userId, path);
  const totals = (await d.get<{ n: number; total: number | null }>("SELECT COUNT(*) AS n, SUM(size) AS total FROM workspace_files WHERE user_id = ?", userId)) ?? { n: 0, total: 0 };
  if (!existing && Number(totals.n) >= MAX_FILES) throw new WorkspaceError(`The workspace is limited to ${MAX_FILES} files.`);
  const total = Number(totals.total ?? 0) - (existing ? Number(existing.size) : 0);
  if (total + bytes > MAX_TOTAL) throw new WorkspaceError("The workspace is full (5 MB). Delete some files first.");
  await d.run(
    `INSERT INTO workspace_files (user_id, path, content, size, modified) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, path) DO UPDATE SET content = excluded.content, size = excluded.size, modified = excluded.modified`,
    userId, path, content, bytes, now());
  return { path, size: bytes, created: !existing };
}

export async function deleteFile(userId: string, rel: string): Promise<void> {
  checkUser(userId);
  const path = cleanPath(rel);
  const info = await db().run("DELETE FROM workspace_files WHERE user_id = ? AND path = ?", userId, path);
  if (!info.changes) throw new WorkspaceError(`No file at ${path}.`);
}

export async function clearWorkspace(userId: string): Promise<void> {
  checkUser(userId);
  await db().run("DELETE FROM workspace_files WHERE user_id = ?", userId);
}
