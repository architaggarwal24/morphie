"use client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { ChatView } from "./chat/ChatView";
import { CommandPalette } from "./CommandPalette";
import { DesignView } from "./design/DesignView";
import { DocumentsView } from "./library/DocumentsView";
import { MemoryView } from "./library/MemoryView";
import { Rail } from "./Rail";
import { SettingsView } from "./settings/SettingsView";
import { ConversationSidebar, DesignSidebar } from "./Sidebar";
import { Toasts } from "./Toasts";
import { Button, Logo, Spinner } from "./ui";

export default function App() {
  const ready = useStore((s) => s.ready);
  const loadError = useStore((s) => s.loadError);
  const boot = useStore((s) => s.boot);
  const tab = useStore((s) => s.tab);
  const activeConv = useStore((s) => s.activeConv);
  const loaded = useStore((s) => s.messages);
  const loadMessages = useStore((s) => s.loadMessages);
  const setPalette = useStore((s) => s.setPalette);

  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(!useStore.getState().paletteOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  // Lazily load history when a conversation becomes active (e.g. after switching tabs).
  const id = tab === "chat" ? activeConv.chat : tab === "agent" ? activeConv.agent : null;
  const runningId = useStore((s) => s.run?.convId ?? null);
  useEffect(() => { if (id && id !== runningId && !loaded[id]) void loadMessages(id); }, [id, runningId, loaded, loadMessages]);

  if (loadError) {
    return (
      <div className="grid h-dvh place-items-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto size-8 text-err" aria-hidden />
          <h1 className="mt-4 font-display text-2xl">Can't reach Morphie</h1>
          <p className="mt-2 text-sm text-muted">{loadError}</p>
          <Button className="mt-5" variant="primary" onClick={() => void boot()}><RefreshCw className="size-4" aria-hidden /> Try again</Button>
        </div>
      </div>
    );
  }
  if (!ready) {
    return <div className="grid h-dvh place-items-center"><div className="flex flex-col items-center gap-4"><Logo className="size-12 animate-pulse-dot" /><Spinner /></div></div>;
  }

  return (
    <div className="surface-grain flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>
      <Rail />
      {(tab === "chat" || tab === "agent") && <ConversationSidebar mode={tab} />}
      {tab === "design" && <DesignSidebar />}
      <main id="main" className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {tab === "chat" && <ChatView key="chat" mode="chat" />}
        {tab === "agent" && <ChatView key="agent" mode="agent" />}
        {tab === "design" && <DesignView />}
        {tab === "documents" && <DocumentsView />}
        {tab === "memory" && <MemoryView />}
        {tab === "settings" && <SettingsView />}
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
