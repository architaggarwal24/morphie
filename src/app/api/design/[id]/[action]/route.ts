import { z } from "zod";
import { applyThemePreset, exportDesign, exportZip, redo, renameDesign, restoreVersion, undo } from "@/server/design/service";
import { ApiError, route } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const format = (url: URL) => url.searchParams.get("format") ?? "html";

export const GET = route(async (c) => {
  if (c.params.action === "export") return await exportDesign(c.userId, c.params.id, format(c.url));
  if (c.params.action === "download") {
    const zip = await exportZip(c.userId, c.params.id, format(c.url));
    return new Response(zip.bytes as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${zip.filename}"`, "x-content-type-options": "nosniff" } });
  }
  throw new ApiError(404, "Not found.", "not_found");
});

export const POST = route(async (c) => {
  const { id, action } = c.params;
  switch (action) {
    case "undo": return { state: await undo(c.userId, id) };
    case "redo": return { state: await redo(c.userId, id) };
    case "restore": return { state: await restoreVersion(c.userId, id, (await c.body(z.object({ version: z.number().int() }))).version) };
    case "rename": return { state: await renameDesign(c.userId, id, (await c.body(z.object({ name: z.string().trim().min(1).max(60) }))).name) };
    case "theme": {
      const out = await applyThemePreset(c.userId, id, (await c.body(z.object({ theme: z.string().max(30) }))).theme);
      return { state: out.state, summary: out.summary, changed: out.changed };
    }
  }
  throw new ApiError(404, "Not found.", "not_found");
});
