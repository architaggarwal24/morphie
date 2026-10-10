import { strToU8, zipSync } from "fflate";
import { ApiError, route } from "@/server/http";
import { listFiles, readAllFiles } from "@/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (c) => {
  if (c.url.searchParams.get("zip")) {
    const files = await readAllFiles(c.userId);
    if (!files.length) throw new ApiError(404, "The workspace is empty.", "empty");
    const zipped = zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])), { level: 6 });
    return new Response(zipped as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="morphie-workspace.zip"', "x-content-type-options": "nosniff" } });
  }
  return { files: await listFiles(c.userId) };
});

