import { route } from "@/server/http";
import { deleteDocument, listDocuments } from "@/server/rag";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (c) => {
  await deleteDocument(c.userId, c.params.id);
  return { documents: await listDocuments(c.userId) };
});
