"use client";
import { create } from "zustand";
import { api, ApiFailure, streamSSE } from "./api";
import { applyEvent, newRun, type RunState } from "./runState";
import type { AgentEvent, AgentSettings, ConversationView, MessageView, Mode, ProfileView, ProviderSpecView, ToolInfo } from "./types";
import { DEFAULT_AGENT_SETTINGS } from "./types";

export type Tab = "chat" | "agent" | "design" | "documents" | "memory" | "settings";
export type ThemePref = "system" | "light" | "dark";

export interface CustomPreset { id: string; label: string; baseUrl: string; note: string; options?: Record<string, unknown> }
export interface Toast { id: number; kind: "error" | "ok" | "info"; text: string }

interface Bootstrap {
  version: string; catalog: ProviderSpecView[]; customPresets: CustomPreset[]; profiles: ProfileView[]; activeId: string | null;
  settings: AgentSettings; tools: ToolInfo[]; search: { user: boolean; server: boolean }; conversations: ConversationView[];
  server: { allowPrivateUrls: boolean; maxUploadMb: number; maxAgentSteps: number };
}

interface State {
  ready: boolean;
  loadError: string | null;
  version: string;
  catalog: ProviderSpecView[];
  customPresets: CustomPreset[];
  profiles: ProfileView[];
  activeId: string | null;
  settings: AgentSettings;
  tools: ToolInfo[];
  search: { user: boolean; server: boolean };
  server: Bootstrap["server"];

  tab: Tab;
  settingsSection: string;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  theme: ThemePref;

  conversations: ConversationView[];
  activeConv: Record<Mode, string | null>;
  messages: Record<string, MessageView[]>;
  run: RunState | null;
  toasts: Toast[];

  boot(): Promise<void>;
  setTab(t: Tab): void;
  setSettingsSection(s: string): void;
  toggleSidebar(open?: boolean): void;
  toggleInspector(open?: boolean): void;
  setPalette(open: boolean): void;
  setTheme(t: ThemePref): void;
  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: number): void;

  setProfiles(profiles: ProfileView[], activeId: string | null): void;
  setSettings(patch: Partial<AgentSettings>): Promise<void>;
  setSearch(s: { user: boolean; server: boolean }): void;

  refreshConversations(q?: string): Promise<void>;
  newConversation(mode: Mode): void;
  openConversation(mode: Mode, id: string): Promise<void>;
  loadMessages(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  pinConversation(id: string, pinned: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  send(message: string, opts?: { truncateFrom?: number }): Promise<void>;
  stop(): void;
  resolveApproval(id: string, approved: boolean, always?: boolean): Promise<void>;
}

let controller: AbortController | null = null;
let toastId = 1;
const raf: (fn: () => void) => void = typeof requestAnimationFrame === "function" ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);

const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : "Something went wrong.");

export const useStore = create<State>((set, get) => ({
  ready: false, loadError: null, version: "", catalog: [], customPresets: [], profiles: [], activeId: null,
  settings: DEFAULT_AGENT_SETTINGS, tools: [], search: { user: false, server: false }, server: { allowPrivateUrls: true, maxUploadMb: 10, maxAgentSteps: 30 },
  tab: "chat", settingsSection: "providers", sidebarOpen: false, inspectorOpen: true, paletteOpen: false, theme: "system",
  conversations: [], activeConv: { chat: null, agent: null }, messages: {}, run: null, toasts: [],

  async boot() {
    try {
      const b = await api<Bootstrap>("/api/bootstrap");
      let theme: ThemePref = "system";
      try { const t = localStorage.getItem("morphie.theme"); if (t === "light" || t === "dark") theme = t; } catch { /* storage blocked */ }
      set({ ready: true, loadError: null, theme, ...b, tab: b.profiles.length ? get().tab : "settings" });
    } catch (e) {
      set({ loadError: errText(e) });
    }
  },
  setTab: (tab) => set({ tab, sidebarOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  toggleSidebar: (open) => set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
  toggleInspector: (open) => set((s) => ({ inspectorOpen: open ?? !s.inspectorOpen })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setTheme(theme) {
    try {
      if (theme === "system") { localStorage.removeItem("morphie.theme"); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem("morphie.theme", theme); document.documentElement.dataset.theme = theme; }
    } catch { /* ignore */ }
    set({ theme });
  },
  toast(kind, text) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setProfiles: (profiles, activeId) => set({ profiles, activeId }),
  setSearch: (search) => set({ search }),
  async setSettings(patch) {
    const prev = get().settings;
    set({ settings: { ...prev, ...patch } });
    try {
      const { temperature, ...rest } = patch;
      const saved = await api<AgentSettings>("/api/settings", { method: "PUT", body: { ...rest, ...(temperature === undefined && "temperature" in patch ? { temperature: null } : temperature !== undefined ? { temperature } : {}) } });
      set({ settings: saved });
    } catch (e) {
      set({ settings: prev });
      get().toast("error", errText(e));
    }
  },

  async refreshConversations(q) {
    try {
      const r = await api<{ conversations: ConversationView[] }>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      set({ conversations: r.conversations });
    } catch (e) { get().toast("error", errText(e)); }
  },
  newConversation(mode) {
    set((s) => ({ activeConv: { ...s.activeConv, [mode]: null }, sidebarOpen: false }));
  },
  async openConversation(mode, id) {
    set((s) => ({ activeConv: { ...s.activeConv, [mode]: id }, sidebarOpen: false }));
    await get().loadMessages(id);
  },
  async loadMessages(id) {
    try {
      const r = await api<{ messages: MessageView[] }>(`/api/conversations/${id}`);
      set((s) => ({ messages: { ...s.messages, [id]: r.messages } }));
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) {
        set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), activeConv: { chat: s.activeConv.chat === id ? null : s.activeConv.chat, agent: s.activeConv.agent === id ? null : s.activeConv.agent } }));
      } else get().toast("error", errText(e));
    }
  },
  async renameConversation(id, title) {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
    try { await api(`/api/conversations/${id}`, { method: "PATCH", body: { title } }); } catch (e) { get().toast("error", errText(e)); void get().refreshConversations(); }
  },
  async pinConversation(id, pinned) {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)) }));
    try { await api(`/api/conversations/${id}`, { method: "PATCH", body: { pinned } }); } catch (e) { get().toast("error", errText(e)); }
    void get().refreshConversations();
  },
  async deleteConversation(id) {
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConv: { chat: s.activeConv.chat === id ? null : s.activeConv.chat, agent: s.activeConv.agent === id ? null : s.activeConv.agent },
      }));
    } catch (e) { get().toast("error", errText(e)); }
  },

  async send(message, opts = {}) {
    const s = get();
    if (s.run && s.run.status !== "done" && s.run.status !== "error") return;
    const mode: Mode = s.tab === "agent" ? "agent" : "chat";
    if (!s.activeId) { get().toast("error", "Add an AI provider in Settings first."); set({ tab: "settings", settingsSection: "providers" }); return; }
    const convId = s.activeConv[mode];
    controller = new AbortController();
    set({ run: newRun({ convId, mode, userMessage: message, truncateFrom: opts.truncateFrom }) });

    // Token deltas arrive far faster than a screen refreshes: coalesce them to one state update per frame.
    let pending: AgentEvent[] = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      if (!pending.length) return;
      const batch = pending; pending = [];
      set((st) => (st.run ? { run: batch.reduce(applyEvent, st.run) } : {}));
    };
    const onEvent = (e: AgentEvent) => {
      if (e.type === "start") {
        const cid = e.conversationId;
        // Seed an empty history so nothing tries to lazy-load this conversation mid-run (it would show the user message twice).
        set((st) => ({ activeConv: { ...st.activeConv, [e.mode]: cid }, messages: st.messages[cid] ? st.messages : { ...st.messages, [cid]: [] } }));
        if (!get().conversations.some((c) => c.id === cid)) {
          const now = Date.now();
          set((st) => ({ conversations: [{ id: cid, title: "New conversation", mode: e.mode, pinned: false, createdAt: now, updatedAt: now }, ...st.conversations] }));
        }
      }
      if (e.type === "title") set((st) => ({ conversations: st.conversations.map((c) => (c.id === get().run?.convId ? { ...c, title: e.title } : c)) }));
      pending.push(e);
      if (e.type === "text" || e.type === "thinking") { if (!scheduled) { scheduled = true; raf(flush); } }
      else flush();
    };

    try {
      await streamSSE<AgentEvent>("/api/chat", { conversationId: convId ?? undefined, mode, message, truncateFrom: opts.truncateFrom }, onEvent, controller.signal);
    } catch (e) {
      onEvent({ type: "error", message: errText(e) });
    }
    flush();
    const finished = get().run;
    const cid = finished?.convId ?? convId;
    if (cid) await get().loadMessages(cid);
    await get().refreshConversations();
    if (finished?.status === "error" && finished.error && !finished.convId) get().toast("error", finished.error);
    set({ run: finished && finished.status === "error" && !cid ? finished : null });
    controller = null;
  },
  stop() { controller?.abort(); },
  async resolveApproval(id, approved, always) {
    set((st) => {
      if (!st.run) return {};
      const { [id]: gone, ...rest } = st.run.approvals;
      return { run: { ...st.run, approvals: rest, status: "running", timeline: st.run.timeline.map((it) => (it.kind === "tool" && it.step.id === gone?.stepId ? { kind: "tool" as const, step: { ...it.step, status: "running" as const } } : it)) } };
    });
    try { await api("/api/agent/approve", { method: "POST", body: { id, approved, always } }); }
    catch (e) { get().toast("error", errText(e)); }
  },
}));
