"use client";
import { Check, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupByRecency, timeAgo } from "@/lib/format";
import { useDesign } from "@/lib/designStore";
import { useStore } from "@/lib/store";
import type { Mode } from "@/lib/types";
import { Button, ConfirmDialog, IconButton, Input, cn } from "./ui";

function Shell({ title, action, children, label }: { title: string; action: React.ReactNode; children: React.ReactNode; label: string }) {
  const open = useStore((s) => s.sidebarOpen);
  const toggle = useStore((s) => s.toggleSidebar);
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => toggle(false)} aria-hidden />}
      <aside aria-label={label} className={cn("z-40 flex-col border-r border-line bg-panel/80 backdrop-blur-sm", open ? "fixed inset-y-0 left-0 flex w-[min(86vw,300px)] shadow-pop md:static md:shadow-none" : "hidden md:flex", "md:w-72 md:shrink-0")}>
        <div className="flex h-14 shrink-0 items-center justify-between px-4"><h2 className="font-display text-lg">{title}</h2><div className="flex items-center gap-1">{action}<IconButton label="Close" className="md:hidden" onClick={() => toggle(false)}><X className="size-4" /></IconButton></div></div>
        {children}
      </aside>
    </>
  );
}

export function ConversationSidebar({ mode }: { mode: Mode }) {
  const { conversations, activeConv, openConversation, newConversation, renameConversation, pinConversation, deleteConversation, refreshConversations, run } = useStore();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [del, setDel] = useState<string | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => void refreshConversations(q.trim() || undefined), 250);
    return () => clearTimeout(t);
  }, [q, refreshConversations]);

  const items = conversations.filter((c) => c.mode === mode);
  const groups = groupByRecency(items);
  const active = activeConv[mode];
  const noun = mode === "agent" ? "task" : "chat";

  return (
    <Shell title={mode === "agent" ? "Tasks" : "Chats"} label="Conversations" action={<Button size="sm" variant="soft" onClick={() => newConversation(mode)}><Plus className="size-4" aria-hidden /> New</Button>}>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}s`} aria-label={`Search ${noun}s`} className="h-9! pl-8" />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label={`${noun} history`}>
        {items.length === 0 && <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-muted">{q ? "Nothing matches that search." : `No ${noun}s yet. Start one below.`}</p>}
        {groups.map(([label, list]) => (
          <div key={label} className="mb-3">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</h3>
            <ul>
              {list.map((c) => {
                const isActive = c.id === active;
                const running = run?.convId === c.id && (run.status === "running" || run.status === "waiting" || run.status === "connecting");
                return (
                  <li key={c.id} className="group relative">
                    {editing === c.id ? (
                      <form className="flex items-center gap-1 px-1 py-0.5" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void renameConversation(c.id, draft.trim()); setEditing(null); }}>
                        <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} className="h-8!" aria-label="Conversation title" maxLength={120} />
                        <IconButton label="Save title" type="submit"><Check className="size-4" /></IconButton>
                      </form>
                    ) : (
                      <>
                        <button onClick={() => void openConversation(mode, c.id)} aria-current={isActive ? "page" : undefined} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition", isActive ? "bg-raised" : "hover:bg-raised/60")}>
                          {c.pinned && <Pin className="size-3 shrink-0 text-accent" aria-label="Pinned" />}
                          <span className="min-w-0 flex-1"><span className={cn("block truncate text-[13px]", isActive && "font-medium")}>{c.title}</span><span className="block text-[11px] text-faint">{running ? <span className="text-ok">Working…</span> : timeAgo(c.updatedAt)}</span></span>
                        </button>
                        <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-raised pl-1 group-hover:flex group-focus-within:flex">
                          <IconButton label={c.pinned ? "Unpin" : "Pin"} className="size-6" onClick={() => void pinConversation(c.id, !c.pinned)}>{c.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}</IconButton>
                          <IconButton label="Rename" className="size-6" onClick={() => { setEditing(c.id); setDraft(c.title); }}><Pencil className="size-3" /></IconButton>
                          <IconButton label="Delete" className="size-6 hover:text-err" onClick={() => setDel(c.id)}><Trash2 className="size-3" /></IconButton>
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <ConfirmDialog open={!!del} title={`Delete this ${noun}?`} body="The conversation and its steps will be permanently removed." onConfirm={() => del && void deleteConversation(del)} onClose={() => setDel(null)} />
    </Shell>
  );
}

export function DesignSidebar() {
  const { designs, activeId, open, remove, loaded, load, busy } = useDesign();
  const toggle = useStore((s) => s.toggleSidebar);
  const [del, setDel] = useState<string | null>(null);
  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  return (
    <Shell title="Designs" label="Design projects" action={<Button size="sm" variant="soft" disabled={!!busy} onClick={() => { void open(null); toggle(false); }}><Plus className="size-4" aria-hidden /> New</Button>}>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Design projects">
        {designs.length === 0 && <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-muted">No designs yet. Describe a site and Morphie will build it.</p>}
        <ul>
          {designs.map((d) => (
            <li key={d.id} className="group relative">
              <button onClick={() => { void open(d.id); toggle(false); }} aria-current={d.id === activeId ? "page" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition", d.id === activeId ? "bg-raised" : "hover:bg-raised/60")}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-sunken font-display text-sm">{d.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className={cn("block truncate text-[13px]", d.id === activeId && "font-medium")}>{d.name}</span><span className="block text-[11px] text-faint">v{d.version} · {timeAgo(d.updatedAt)}</span></span>
              </button>
              <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-lg bg-raised group-hover:flex group-focus-within:flex"><IconButton label={`Delete ${d.name}`} className="size-6 hover:text-err" onClick={() => setDel(d.id)}><Trash2 className="size-3" /></IconButton></span>
            </li>
          ))}
        </ul>
      </nav>
      <ConfirmDialog open={!!del} title="Delete this design?" body="The design and its whole version history will be permanently removed." onConfirm={() => del && void remove(del)} onClose={() => setDel(null)} />
    </Shell>
  );
}
