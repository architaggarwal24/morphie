"use client";
import { Brain, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { MemoryView as Memory } from "@/lib/types";
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Input, Select, Spinner, Switch } from "../ui";

const CATEGORIES = ["preference", "profile", "project", "workflow", "technical", "other"] as const;
const TONE: Record<string, "accent" | "info" | "ok" | "warn" | "neutral"> = { preference: "accent", profile: "info", project: "ok", workflow: "warn", technical: "neutral", other: "neutral" };

export function MemoryView() {
  const { settings, setSettings, toast } = useStore();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("preference");
  const [adding, setAdding] = useState(false);
  const [clear, setClear] = useState(false);

  const load = useCallback(async () => { try { setItems((await api<{ memories: Memory[] }>("/api/memory")).memories); } catch (e) { toast("error", (e as Error).message); setItems([]); } }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (items ?? []).filter((m) => !q.trim() || `${m.content} ${m.category}`.toLowerCase().includes(q.toLowerCase())), [items, q]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try { setItems((await api<{ memories: Memory[] }>("/api/memory", { method: "POST", body: { content: text, category: cat } })).memories); setText(""); }
    catch (err) { toast("error", (err as Error).message); } finally { setAdding(false); }
  }
  const remove = async (id: string) => { try { setItems((await api<{ memories: Memory[] }>(`/api/memory/${id}`, { method: "DELETE" })).memories); } catch (e) { toast("error", (e as Error).message); } };
  const clearAll = async () => { try { setItems((await api<{ memories: Memory[] }>("/api/memory", { method: "DELETE" })).memories); } catch (e) { toast("error", (e as Error).message); } };

  return (
    <div className="h-full flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 pb-24 md:px-8 md:py-10 md:pb-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl"><h1 className="font-display text-3xl">Memory</h1><p className="mt-1.5 text-sm leading-relaxed text-muted">Short facts Morphie carries between conversations. It saves them only from what <em>you</em> say, never stores secrets or instructions, and you can edit this list any time.</p></div>
          <label className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm"><span>Remember things</span><Switch checked={settings.memory} onChange={(v) => setSettings({ memory: v })} label="Remember things" /></label>
        </header>

        <form onSubmit={add} className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-3 sm:flex-row">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something to remember, e.g. “I prefer concise answers”" aria-label="New memory" maxLength={300} className="flex-1" />
          <Select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Category" className="sm:w-36">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          <Button type="submit" variant="primary" loading={adding} disabled={text.trim().length < 3}><Plus className="size-4" aria-hidden /> Add</Button>
        </form>

        {items === null ? <div className="grid place-items-center py-10"><Spinner /></div> : items.length === 0 ? (
          <EmptyState icon={<Brain className="size-5" />} title="No memories yet">As you chat, Morphie will note lasting preferences and facts here. Or add one yourself above.</EmptyState>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter memories" aria-label="Filter memories" className="h-9 pl-8 text-[13px]" /></div>
              <span className="text-xs text-muted">{items.length} saved</span>
              <Button size="sm" variant="ghost" className="hover:text-err" onClick={() => setClear(true)}>Clear all</Button>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
              {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No memories match.</li>}
              {shown.map((m) => (
                <li key={m.id} className="group flex items-start gap-3 px-4 py-3">
                  <Brain className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="text-sm leading-relaxed">{m.content}</p><div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge tone={TONE[m.category] ?? "neutral"}>{m.category}</Badge>{m.source !== "auto" && <Badge>{m.source}</Badge>}<span className="text-[11px] text-faint">{timeAgo(m.updatedAt)}</span></div></div>
                  <IconButton label="Forget this" className="hover:text-err" onClick={() => void remove(m.id)}><Trash2 className="size-4" /></IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <ConfirmDialog open={clear} title="Forget everything?" confirm="Clear all" body="All saved memories will be permanently deleted." onConfirm={() => void clearAll()} onClose={() => setClear(false)} />
    </div>
  );
}
