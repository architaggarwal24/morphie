import { route } from "@/server/http";
import { deleteDocument, listDocuments } from "@/server/rag";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (c) => {
  deleteDocument(c.userId, c.params.id);
  return { documents: listDocuments(c.userId) };
});
