"use client";
import { CheckCircle2, FileSpreadsheet, FileText, FileType2, Library, Loader2, Trash2, UploadCloud, XCircle, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { bytes, timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DocumentView } from "@/lib/types";
import { Badge, ConfirmDialog, EmptyState, IconButton, Spinner, cn } from "../ui";

const ICON: Record<string, LucideIcon> = { pdf: FileType2, docx: FileText, txt: FileText, md: FileText, csv: FileSpreadsheet, json: FileText };
interface Upload { name: string; state: "uploading" | "done" | "error"; message?: string }

export function DocumentsView() {
  const { toast, server } = useStore();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [del, setDel] = useState<DocumentView | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { try { setDocs((await api<{ documents: DocumentView[] }>("/api/documents")).documents); } catch (e) { toast("error", (e as Error).message); setDocs([]); } }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: File[]) {
    const limit = server.maxUploadMb * 1048576;
    setUploads(files.map((f) => ({ name: f.name, state: "uploading" })));
    for (const [i, f] of files.entries()) {
      const patch = (u: Partial<Upload>) => setUploads((list) => list.map((x, j) => (j === i ? { ...x, ...u } : x)));
      if (f.size > limit) { patch({ state: "error", message: `Over the ${server.maxUploadMb} MB limit.` }); continue; }
      const form = new FormData();
      form.set("file", f);
      try {
        const r = await api<{ created: boolean; documents: DocumentView[] }>("/api/documents", { method: "POST", form });
        setDocs(r.documents);
        patch({ state: "done", message: r.created ? undefined : "Already uploaded." });
      } catch (e) { patch({ state: "error", message: (e as Error).message }); }
    }
    setTimeout(() => setUploads((u) => u.filter((x) => x.state === "error")), 4000);
  }

  const remove = async (d: DocumentView) => { try { setDocs((await api<{ documents: DocumentView[] }>(`/api/documents/${d.id}`, { method: "DELETE" })).documents); } catch (e) { toast("error", (e as Error).message); } };

  return (
    <div className="h-full flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-10 md:pb-10">
        <header>
          <h1 className="font-display text-3xl">Documents</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">Upload files once and Chat and Agent search them automatically when a question needs them, citing the file name. Text is indexed locally; nothing is sent anywhere until a passage is used in an answer.</p>
        </header>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = [...e.dataTransfer.files]; if (f.length) void upload(f); }}
          className={cn("rounded-2xl border-2 border-dashed p-8 text-center transition", drag ? "border-accent bg-accent/5" : "border-line bg-panel/60")}
        >
          <UploadCloud className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-3 text-sm font-medium">Drop files here, or <button onClick={() => input.current?.click()} className="text-accent underline underline-offset-2">browse</button></p>
          <p className="mt-1 text-xs text-muted">PDF, Word (.docx), text, Markdown, CSV and JSON · up to {server.maxUploadMb} MB each</p>
          <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json" aria-label="Choose documents to upload" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload(f); }} />
        </div>

        {uploads.length > 0 && (
          <ul className="space-y-1.5" aria-live="polite">
            {uploads.map((u, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2 text-sm">
                {u.state === "uploading" ? <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> : u.state === "done" ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <XCircle className="size-4 text-err" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.message && <span className={cn("text-xs", u.state === "error" ? "text-err" : "text-muted")}>{u.message}</span>}
              </li>
            ))}
          </ul>
        )}

        {docs === null ? <div className="grid place-items-center py-10"><Spinner /></div> : docs.length === 0 ? (
          <EmptyState icon={<Library className="size-5" />} title="Nothing here yet">Add a contract, a paper, meeting notes or a spreadsheet, then ask about it in Chat.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel" aria-label="Uploaded documents">
            {docs.map((d) => {
              const Icon = ICON[d.kind] ?? FileText;
              return (
                <li key={d.id} className="group flex items-center gap-3 px-4 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-sunken text-muted"><Icon className="size-[18px]" aria-hidden /></span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{d.name}</div><div className="mt-0.5 text-xs text-muted">{bytes(d.size)} · {d.chunkCount} section{d.chunkCount === 1 ? "" : "s"} · {timeAgo(d.createdAt)}</div></div>
                  <Badge className="hidden sm:inline-flex">{d.kind}</Badge>
                  <IconButton label={`Delete ${d.name}`} className="hover:text-err" onClick={() => setDel(d)}><Trash2 className="size-4" /></IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog open={!!del} title="Delete document?" body={<>“{del?.name}” and its search index will be removed. Past conversations keep any answers already given.</>} onConfirm={() => del && void remove(del)} onClose={() => setDel(null)} />
    </div>
  );
}
