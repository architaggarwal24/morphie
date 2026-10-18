"use client";
import { Check, ChevronDown, Plug, Settings2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { ProfileView } from "@/lib/types";
import { cn, useDismiss } from "../ui";

/** Shows the active model and lets you hop between saved providers without opening Settings. */
export function ProviderChip({ disabled }: { disabled?: boolean }) {
  const { profiles, activeId, setProfiles, setTab, setSettingsSection, toast } = useStore();
  const loggedIn = useStore((s) => !!s.session);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const active = profiles.find((p) => p.id === activeId);

  async function pick(p: ProfileView) {
    setOpen(false);
    if (p.id === activeId) return;
    try { const r = await api<{ profiles: ProfileView[]; activeId: string | null }>(`/api/providers/${p.id}/activate`, { method: "POST", body: {} }); setProfiles(r.profiles, r.activeId); }
    catch (e) { toast("error", (e as Error).message); }
  }

  if (!active) {
    return <button onClick={(e) => { setTab("settings", e.currentTarget); setSettingsSection("providers"); }} aria-haspopup={loggedIn ? undefined : "dialog"} className="flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn/5 px-2.5 py-1 text-xs text-warn"><Plug className="size-3.5" aria-hidden /> Connect a provider</button>;
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className="flex max-w-[240px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-raised hover:text-fg disabled:opacity-60">
        <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
        <span className="truncate font-medium text-fg">{active.label}</span>
        <span className="truncate font-mono text-faint">{active.model}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
      {open && (
        <div role="listbox" aria-label="Switch provider" className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl bg-panel p-1 shadow-pop animate-rise">
          <div className="max-h-64 overflow-auto">
            {profiles.map((p) => (
              <button key={p.id} role="option" aria-selected={p.id === activeId} onClick={() => pick(p)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-raised", p.id === activeId && "bg-raised")}>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p.label}</div><div className="truncate font-mono text-[11px] text-muted">{p.model}</div></div>
                {p.id === activeId && <Check className="size-4 text-accent" aria-hidden />}
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); setTab("settings"); setSettingsSection("providers"); }} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-sm text-muted transition hover:bg-raised hover:text-fg"><Settings2 className="size-4" aria-hidden /> Manage providers</button>
        </div>
      )}
    </div>
  );
}
