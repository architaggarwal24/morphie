"use client";
import { Bot, Brain, Library, MessagesSquare, Monitor, Moon, Settings, Sun, WandSparkles, type LucideIcon } from "lucide-react";
import { useStore, type Tab } from "@/lib/store";
import { Logo, cn } from "./ui";

export const NAV: Array<{ tab: Tab; label: string; icon: LucideIcon }> = [
  { tab: "chat", label: "Chat", icon: MessagesSquare },
  { tab: "agent", label: "Agent", icon: Bot },
  { tab: "design", label: "Design", icon: WandSparkles },
  { tab: "documents", label: "Documents", icon: Library },
  { tab: "memory", label: "Memory", icon: Brain },
];

export function Rail() {
  const { tab, setTab, theme, setTheme, run } = useStore();
  const working = !!run && (run.status === "running" || run.status === "waiting" || run.status === "connecting");
  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const ThemeIcon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;

  const item = (t: Tab, label: string, Icon: LucideIcon, mobile = false) => {
    const active = tab === t;
    return (
      <button key={t} onClick={() => setTab(t)} aria-current={active ? "page" : undefined} className={cn("relative flex items-center justify-center rounded-xl transition", mobile ? "h-full flex-1 flex-col gap-0.5 text-[10px]" : "size-[52px] flex-col gap-1 text-[10px]", active ? "text-fg" : "text-muted hover:text-fg")}>
        <span className={cn("grid place-items-center rounded-xl transition", mobile ? "h-7 w-12" : "size-9", active && "bg-accent/12 text-accent")}>
          <Icon className="size-[19px]" aria-hidden />
        </span>
        <span className="font-medium">{label}</span>
        {(t === "chat" || t === "agent") && working && run?.mode === t && <span className="absolute right-2.5 top-1.5 size-2 animate-pulse-dot rounded-full bg-ok" aria-label="Working" />}
      </button>
    );
  };

  return (
    <>
      <nav aria-label="Primary" className="hidden w-[72px] shrink-0 flex-col items-center gap-1 border-r border-line bg-sunken/60 py-4 md:flex">
        <div className="mb-3"><Logo className="size-9" /></div>
        {NAV.map((n) => item(n.tab, n.label, n.icon))}
        <div className="mt-auto flex flex-col items-center gap-1">
          <button onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`} title={`Theme: ${theme}`} className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-raised hover:text-fg"><ThemeIcon className="size-[18px]" /></button>
          {item("settings", "Settings", Settings)}
        </div>
      </nav>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-line bg-panel/95 px-1 backdrop-blur md:hidden">
        {[...NAV, { tab: "settings" as Tab, label: "Settings", icon: Settings }].map((n) => item(n.tab, n.label, n.icon, true))}
      </nav>
    </>
  );
}
