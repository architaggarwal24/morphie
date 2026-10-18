"use client";
import { ArrowUp, Bot, Brain, Library, LogIn, MessagesSquare, Moon, Plus, Search, Settings, Sun, WandSparkles, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDesign } from "@/lib/designStore";
import { PUBLIC_TAB, useStore, type Tab } from "@/lib/store";
import type { ProfileView } from "@/lib/types";
import { Dialog, Kbd, cn } from "./ui";

interface Cmd { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void }

export function CommandPalette() {
  const { paletteOpen, setPalette, setTab, newConversation, profiles, activeId, setProfiles, setTheme, toast, setSettingsSection, openLogin, sendDraft } = useStore();
  const loggedIn = useStore((s) => !!s.session);
  const mode = useStore((s) => (s.tab === "agent" ? "agent" : "chat"));
  const hasDraft = useStore((s) => s.drafts[s.tab === "agent" ? "agent" : "chat"].trim().length > 0);
  const openDesign = useDesign((d) => d.open);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // What had focus before the palette opened. If a command ends in the login popup, focus returns there when it closes.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { if (paletteOpen) opener.current = document.activeElement as HTMLElement | null; }, [paletteOpen]);

  const cmds: Cmd[] = useMemo(() => {
    // Logged out, only Chat is open: every command that goes anywhere else opens the login popup (and resumes there after login).
    const needsLogin = (tab: Tab | null, run: () => void) => (loggedIn || tab === PUBLIC_TAB ? run : () => openLogin({ tab, trigger: opener.current }));
    const go = (tab: Tab) => needsLogin(tab, () => setTab(tab));
    const base: Cmd[] = [
      ...(hasDraft ? [{ id: "send", label: "Send message", hint: "Enter", icon: ArrowUp, run: () => sendDraft(mode, opener.current) }] : []),
      { id: "new-chat", label: "New chat", icon: Plus, run: needsLogin("chat", () => { setTab("chat"); newConversation("chat"); }) },
      { id: "new-task", label: "New agent task", icon: Plus, run: needsLogin("agent", () => { setTab("agent"); newConversation("agent"); }) },
      { id: "new-design", label: "New design", icon: Plus, run: needsLogin("design", () => { setTab("design"); void openDesign(null); }) },
      { id: "chat", label: "Go to Chat", icon: MessagesSquare, run: go("chat") },
      { id: "agent", label: "Go to Agent", icon: Bot, run: go("agent") },
      { id: "design", label: "Go to Design", icon: WandSparkles, run: go("design") },
      { id: "documents", label: "Go to Documents", icon: Library, run: go("documents") },
      { id: "memory", label: "Go to Memory", icon: Brain, run: go("memory") },
      ...(loggedIn
        ? [{ id: "settings", label: "Open Settings", icon: Settings, run: go("settings") }]
        : [{ id: "login", label: "Log in or sign up", icon: LogIn, run: () => openLogin({ trigger: opener.current }) }]),
      { id: "add-provider", label: "Add a provider", hint: "Settings", icon: Plus, run: needsLogin("settings", () => { setTab("settings"); setSettingsSection("providers"); }) },
      { id: "theme-light", label: "Light theme", icon: Sun, run: () => setTheme("light") },
      { id: "theme-dark", label: "Dark theme", icon: Moon, run: () => setTheme("dark") },
    ];
    const switches: Cmd[] = profiles.filter((p) => p.id !== activeId).map((p: ProfileView) => ({
      id: `use-${p.id}`, label: `Use ${p.label}`, hint: p.model, icon: Bot,
      run: () => { api<{ profiles: ProfileView[]; activeId: string | null }>(`/api/providers/${p.id}/activate`, { method: "POST", body: {} }).then((r) => setProfiles(r.profiles, r.activeId)).catch((e) => toast("error", e.message)); },
    }));
    return [...switches, ...base];
  }, [profiles, activeId, loggedIn, hasDraft, mode, setTab, newConversation, openDesign, setProfiles, setTheme, toast, setSettingsSection, openLogin, sendDraft]);

  const shown = cmds.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => { setSel(0); }, [q, paletteOpen]);
  useEffect(() => { if (!paletteOpen) setQ(""); }, [paletteOpen]);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const exec = (c?: Cmd) => { if (!c) return; setPalette(false); c.run(); };

  return (
    <Dialog open={paletteOpen} onClose={() => setPalette(false)} title="Command palette" width="max-w-xl">
      <div className="-mx-1 -mt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command…" aria-label="Search commands"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); exec(shown[sel]); }
            }}
            className="h-11 w-full rounded-xl border border-line bg-sunken pl-10 pr-3 text-sm outline-hidden focus:border-accent/60"
          />
        </div>
        <ul ref={list} role="listbox" className="mt-2 max-h-72 overflow-y-auto">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matching commands.</li>}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={() => exec(c)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", i === sel && "bg-raised")}>
                <c.icon className="size-4 text-muted" aria-hidden /><span className="flex-1">{c.label}</span>{c.hint && <span className="font-mono text-[11px] text-faint">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[11px] text-faint"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate <Kbd>Enter</Kbd> run <Kbd>Esc</Kbd> close</p>
      </div>
    </Dialog>
  );
}
