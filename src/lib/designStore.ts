"use client";
import { create } from "zustand";
import { api, ApiFailure, streamSSE } from "./api";
import type { DesignEvent, DesignState, DesignSummary, DesignThemeView } from "./types";
import { useStore } from "./store";

export type Device = "desktop" | "tablet" | "mobile";
export const DEVICE_WIDTHS: Record<Device, number> = { desktop: 1280, tablet: 768, mobile: 390 };

export interface DesignTurn { id: number; prompt: string; reply?: string; kind?: string; error?: boolean; changed?: boolean; notes?: string[] }

interface DesignStore {
  loaded: boolean;
  designs: DesignSummary[];
  themes: DesignThemeView[];
  activeId: string | null;
  state: DesignState | null;
  device: Device;
  busy: { stage: string; attempt: number } | null;
  turns: DesignTurn[];
  load(): Promise<void>;
  open(id: string | null): Promise<void>;
  setDevice(d: Device): void;
  send(message: string): Promise<void>;
  stop(): void;
  act(action: "undo" | "redo", ): Promise<void>;
  restore(version: number): Promise<void>;
  applyTheme(theme: string): Promise<void>;
  rename(name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

let controller: AbortController | null = null;
let turnId = 1;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const toast = (kind: "error" | "ok" | "info", text: string) => useStore.getState().toast(kind, text);

export const useDesign = create<DesignStore>((set, get) => ({
  loaded: false, designs: [], themes: [], activeId: null, state: null, device: "desktop", busy: null, turns: [],

  async load() {
    try {
      const r = await api<{ designs: DesignSummary[]; themes: DesignThemeView[] }>("/api/design");
      set({ designs: r.designs, themes: r.themes, loaded: true });
    } catch (e) { toast("error", errText(e)); }
  },
  async open(id) {
    if (!id) { set({ activeId: null, state: null, turns: [] }); return; }
    try {
      const r = await api<{ state: DesignState }>(`/api/design/${id}`);
      set({ activeId: id, state: r.state, turns: [] });
    } catch (e) {
      toast("error", errText(e));
      void get().load();
    }
  },
  setDevice: (device) => set({ device }),

  async send(message) {
    if (get().busy) return;
    if (!useStore.getState().activeId) { toast("error", "Add an AI provider in Settings first."); useStore.getState().setTab("settings"); return; }
    const id = turnId++;
    controller = new AbortController();
    set((s) => ({ busy: { stage: "drafting", attempt: 0 }, turns: [...s.turns, { id, prompt: message }] }));
    const finishTurn = (patch: Partial<DesignTurn>) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    try {
      await streamSSE<DesignEvent>("/api/design", { designId: get().activeId, message }, (e) => {
        if (e.type === "stage") set({ busy: { stage: e.stage, attempt: e.attempt } });
        else if (e.type === "result") {
          set({ state: e.state, activeId: e.state.id });
          finishTurn({ reply: e.summary, kind: e.kind, changed: e.changed, notes: e.notes });
        } else if (e.type === "clarify") finishTurn({ reply: e.message, kind: "clarify" });
        else if (e.type === "error") finishTurn({ reply: e.message, error: true });
      }, controller.signal);
      if (controller.signal.aborted) finishTurn({ reply: "Stopped.", error: true });
    } catch (e) {
      finishTurn({ reply: errText(e), error: true });
    } finally {
      set({ busy: null });
      controller = null;
      void get().load();
    }
  },
  stop() { controller?.abort(); },

  async act(action) {
    const id = get().activeId;
    if (!id) return;
    try { const r = await api<{ state: DesignState }>(`/api/design/${id}/${action}`, { method: "POST", body: {} }); set({ state: r.state }); void get().load(); }
    catch (e) { toast(e instanceof ApiFailure && e.status === 409 ? "info" : "error", errText(e)); }
  },
  async restore(version) {
    const id = get().activeId;
    if (!id) return;
    try { const r = await api<{ state: DesignState }>(`/api/design/${id}/restore`, { method: "POST", body: { version } }); set({ state: r.state }); }
    catch (e) { toast("error", errText(e)); }
  },
  async applyTheme(theme) {
    const id = get().activeId;
    if (!id) return;
    try {
      const r = await api<{ state: DesignState; summary: string }>(`/api/design/${id}/theme`, { method: "POST", body: { theme } });
      set({ state: r.state });
      toast("ok", r.summary);
      void get().load();
    } catch (e) { toast("error", errText(e)); }
  },
  async rename(name) {
    const id = get().activeId;
    if (!id) return;
    try { const r = await api<{ state: DesignState }>(`/api/design/${id}/rename`, { method: "POST", body: { name } }); set({ state: r.state }); void get().load(); }
    catch (e) { toast("error", errText(e)); }
  },
  async remove(id) {
    try {
      await api(`/api/design/${id}`, { method: "DELETE" });
      if (get().activeId === id) set({ activeId: null, state: null, turns: [] });
      void get().load();
    } catch (e) { toast("error", errText(e)); }
  },
}));
