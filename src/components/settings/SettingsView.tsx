"use client";
import { Database, KeyRound, Palette, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "../ui";
import { AgentSection, AppearanceSection, DataSection, ToolsSection } from "./OtherSections";
import { ProvidersSection } from "./ProvidersSection";

const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "agent", label: "Chat & agent", icon: SlidersHorizontal },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "data", label: "Data & privacy", icon: Database },
];

export function SettingsView() {
  const { settingsSection, setSettingsSection } = useStore();
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Settings sections" className="shrink-0 border-b border-line md:w-56 md:border-b-0 md:border-r">
        <h1 className="hidden px-5 pb-2 pt-5 font-display text-xl md:block">Settings</h1>
        <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button onClick={() => setSettingsSection(s.id)} aria-current={settingsSection === s.id ? "page" : undefined} className={cn("flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition", settingsSection === s.id ? "bg-raised font-medium" : "text-muted hover:bg-raised/60 hover:text-fg")}>
                <s.icon className="size-4" aria-hidden /> {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-10 animate-rise" key={settingsSection}>
          {settingsSection === "providers" && <ProvidersSection />}
          {settingsSection === "agent" && <AgentSection />}
          {settingsSection === "tools" && <ToolsSection />}
          {settingsSection === "appearance" && <AppearanceSection />}
          {settingsSection === "data" && <DataSection />}
        </div>
      </div>
    </div>
  );
}
