import { ApiError, route } from "@/server/http";
import { WorkspaceError, deleteFile, listFiles, readFile } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function wrap<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof WorkspaceError) throw new ApiError(400, e.message, "workspace"); throw e; }
}
const pathOf = (url: URL) => url.searchParams.get("path") ?? "";

export const GET = route(async (c) => {
  const path = pathOf(c.url);
  const content = wrap(() => readFile(c.userId, path));
  if (c.url.searchParams.get("download")) {
    // Always served as an attachment with a neutral type so a stored .html file can never run on our origin.
    const name = path.split("/").pop()!.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(content, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "x-content-type-options": "nosniff" } });
  }
  return { path, content };
});

export const DELETE = route(async (c) => {
  wrap(() => deleteFile(c.userId, pathOf(c.url)));
  return { files: listFiles(c.userId) };
});
