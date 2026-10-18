"use client";
import { ArrowUp, Check, Download, History, Menu, Monitor, Palette, PanelRight, Pencil, Redo2, Smartphone, Sparkles, Square, Tablet, Undo2, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEVICE_WIDTHS, useDesign, type Device } from "@/lib/designStore";
import { timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DesignState } from "@/lib/types";
import { Badge, Button, IconButton, Input, Kbd, cn, useDismiss } from "../ui";
import { ExportDialog } from "./ExportDialog";
import { Preview } from "./Preview";

const NEW_IDEAS = [
  "A dark landing page for a fintech startup that helps freelancers get paid faster",
  "A portfolio site for a wedding photographer with a warm, editorial feel",
  "A SaaS marketing site with pricing and FAQ for a project-management tool",
  "A dashboard-style overview page for a logistics company",
];
const EDIT_IDEAS = ["Make it darker", "Add an FAQ section", "Make the hero bigger", "Use purple accents", "Use the Premium theme", "Make the cards more rounded"];
const STAGE: Record<string, string> = { drafting: "Designing…", validating: "Checking the result…", repairing: "Fixing a few issues…" };
const DEVICES: Array<{ d: Device; icon: typeof Monitor; label: string }> = [{ d: "desktop", icon: Monitor, label: "Desktop" }, { d: "tablet", icon: Tablet, label: "Tablet" }, { d: "mobile", icon: Smartphone, label: "Mobile" }];

function ThemePicker({ state }: { state: DesignState }) {
  const { themes, applyTheme, busy } = useDesign();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const keys = ["background", "surface", "primary", "secondary", "accent"];
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!!busy}><Palette className="size-4" aria-hidden /> Theme</Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(88vw,340px)] rounded-2xl bg-panel p-2 shadow-pop animate-rise">
          <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted">Applies colours, fonts, corners and shadow in one step. Undo restores your previous look.</p>
          <ul className="max-h-80 space-y-1 overflow-auto">
            {themes.map((t) => {
              const current = keys.every((k) => state.design.theme[k] === t.colors[k]);
              return (
                <li key={t.id}>
                  <button onClick={() => { setOpen(false); void applyTheme(t.id); }} className={cn("flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-raised", current && "bg-raised")}>
                    <span className="flex shrink-0 overflow-hidden rounded-lg border border-line" aria-hidden>{keys.map((k) => <span key={k} className="h-9 w-4" style={{ background: t.colors[k] }} />)}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-medium">{t.name}{current && <Check className="size-3.5 text-accent" aria-hidden />}</span><span className="block truncate text-[11px] text-muted">{t.description}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function VersionMenu({ state }: { state: DesignState }) {
  const restore = useDesign((d) => d.restore);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <IconButton label="Version history" onClick={() => setOpen((o) => !o)} active={open}><History className="size-4" /></IconButton>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(88vw,320px)] rounded-2xl bg-panel p-2 shadow-pop animate-rise">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">History · last {state.versions.length}</p>
          <ul className="max-h-80 overflow-auto">
            {state.versions.map((v) => (
              <li key={v.version}>
                <button disabled={v.current} onClick={() => { setOpen(false); void restore(v.version); }} className={cn("flex w-full items-start gap-2.5 rounded-xl p-2 text-left transition hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent", v.current && "bg-raised")}>
                  <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md font-mono text-[10px]", v.current ? "bg-accent text-accent-fg" : "border border-line text-muted")}>v{v.version}</span>
                  <span className="min-w-0 flex-1"><span className="line-clamp-2 text-[13px] leading-snug">{v.summary || v.prompt}</span><span className="text-[11px] text-faint">{timeAgo(v.createdAt)}{v.current ? " · current" : ""}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Inspector({ state }: { state: DesignState }) {
  const d = state.design;
  return (
    <aside aria-label="Design details" className="hidden w-64 shrink-0 overflow-y-auto border-l border-line bg-panel xl:block">
      <section className="border-b border-line p-4">
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Palette</h3>
        <ul className="grid grid-cols-3 gap-2">
          {Object.entries(d.theme).map(([k, v]) => (
            <li key={k} className="text-center"><span className="block h-10 rounded-lg border border-line" style={{ background: v }} title={v} /><span className="mt-1 block truncate text-[10px] text-muted">{k}</span><span className="block font-mono text-[10px] text-faint">{v}</span></li>
          ))}
        </ul>
      </section>
      <section className="border-b border-line p-4 text-sm">
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Type & shape</h3>
        <dl className="space-y-1.5 text-[13px]">
          {[["Headings", d.typography.heading], ["Body", d.typography.body], ["Scale", d.typography.scale], ["Corners", d.style.radius], ["Shadow", d.style.shadow], ["Spacing", d.layout.spacing], ["Max width", d.layout.max_width]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
          ))}
        </dl>
      </section>
      <section className="p-4">
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Sections · {d.sections.length}</h3>
        <ol className="space-y-1">
          {d.sections.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[13px]"><span className="font-mono text-[10px] text-faint">{i + 1}</span><span className="font-medium capitalize">{s.type}</span><span className="ml-auto truncate font-mono text-[10px] text-faint">#{s.id}</span></li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

export function DesignView() {
  const { state, turns, busy, send, stop, device, setDevice, act, rename, loaded, load } = useDesign();
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const [text, setText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [inspector, setInspector] = useState(true);
  const feed = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; } }, [text]);

  const submit = (t = text) => { const v = t.trim(); if (!v || busy) return; setText(""); void send(v); };
  const ideas = state ? EDIT_IDEAS : NEW_IDEAS;
  const hist = state?.history;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col lg:flex-row">
      {/* ---- left: conversation ---- */}
      <section className="flex max-h-[46%] min-h-0 shrink-0 flex-col border-b border-line lg:max-h-none lg:w-[360px] lg:border-b-0 lg:border-r" aria-label="Design assistant">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
          <IconButton label="Open projects" className="md:hidden" onClick={() => toggleSidebar(true)}><Menu className="size-[18px]" /></IconButton>
          {editingName && state ? (
            <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void rename(name.trim()); setEditingName(false); }}>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditingName(false)} maxLength={60} aria-label="Design name" className="h-8! text-sm" />
              <IconButton label="Save name" type="submit"><Check className="size-4" /></IconButton>
            </form>
          ) : (
            <>
              <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{state?.name ?? "New design"}</h1>
              {state && <IconButton label="Rename" onClick={() => { setName(state.name); setEditingName(true); }}><Pencil className="size-3.5" /></IconButton>}
            </>
          )}
          {hist && <Badge>v{hist.version}</Badge>}
        </header>

        <div ref={feed} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && !busy && (
            <div className="animate-rise space-y-4 py-2">
              <h2 className="font-display text-2xl leading-tight">{state ? <>What should<br /><span className="text-muted">change?</span></> : <>Describe a site.<br /><span className="text-muted">I'll build it.</span></>}</h2>
              <p className="text-[13px] leading-relaxed text-muted">{state ? "Ask for tweaks in plain language. Each change is a small, reversible edit." : "Mood, audience and sections help. Everything is generated as validated, exportable code."}</p>
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className="space-y-2 animate-rise">
              <p className="rounded-2xl border border-line bg-raised px-3.5 py-2.5 text-sm leading-relaxed">{t.prompt}</p>
              {t.reply ? (
                <div className="flex gap-2.5">
                  <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg", t.error ? "bg-err/15 text-err" : "bg-accent text-accent-fg")}><Sparkles className="size-3.5" aria-hidden /></span>
                  <div className="min-w-0 flex-1 text-sm leading-relaxed">
                    <p className={t.error ? "text-err" : undefined}>{t.reply}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {t.kind && !t.error && <Badge tone={t.kind === "clarify" ? "warn" : "accent"}>{t.kind === "create" ? "Created" : t.kind === "edit" ? "Edited" : t.kind === "theme" ? "Theme" : "Needs info"}</Badge>}
                      {t.changed === false && <Badge>No change</Badge>}
                    </div>
                    {t.notes && t.notes.length > 0 && <details className="mt-1.5 text-xs text-muted"><summary className="cursor-pointer">{t.notes.length} automatic adjustment{t.notes.length === 1 ? "" : "s"}</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{t.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
                  </div>
                </div>
              ) : busy && t === turns[turns.length - 1] ? (
                <div className="flex items-center gap-2.5 text-sm text-muted"><span className="grid size-6 place-items-center rounded-lg bg-accent text-accent-fg"><Sparkles className="size-3.5 animate-pulse-dot" aria-hidden /></span>{STAGE[busy.stage] ?? "Working…"}{busy.attempt > 0 && <span className="font-mono text-[11px] text-faint">attempt {busy.attempt + 1}</span>}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-line p-3">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Suggestions">
            {ideas.slice(0, state ? 6 : 4).map((s) => <button key={s} disabled={!!busy} onClick={() => submit(s)} className="shrink-0 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50">{s.length > 44 ? s.slice(0, 43) + "…" : s}</button>)}
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
            <textarea ref={ta} value={text} rows={1} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} placeholder={state ? "Describe a change…" : "Describe the site you want…"} aria-label="Design instruction" maxLength={4000} className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-hidden placeholder:text-faint" />
            {busy ? <button onClick={stop} aria-label="Stop" className="grid size-9 shrink-0 place-items-center rounded-xl bg-fg text-bg"><Square className="size-3.5 fill-current" /></button>
              : <button onClick={() => submit()} disabled={!text.trim()} aria-label="Send" className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-30"><ArrowUp className="size-[18px]" /></button>}
          </div>
          <p className="mt-1.5 hidden text-center text-[11px] text-faint sm:block"><Kbd>Enter</Kbd> to send</p>
        </div>
      </section>

      {/* ---- center: preview ---- */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Preview">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
          <div className="inline-flex rounded-xl border border-line bg-sunken p-0.5" role="radiogroup" aria-label="Preview device">
            {DEVICES.map(({ d, icon: Icon, label }) => (
              <button key={d} role="radio" aria-checked={device === d} aria-label={`${label} (${DEVICE_WIDTHS[d]}px)`} title={`${label} · ${DEVICE_WIDTHS[d]}px`} onClick={() => setDevice(d)} className={cn("grid size-8 place-items-center rounded-lg transition", device === d ? "bg-panel text-fg shadow-xs" : "text-muted hover:text-fg")}><Icon className="size-4" /></button>
            ))}
          </div>
          <span className="hidden font-mono text-[11px] text-faint sm:block">{DEVICE_WIDTHS[device]}px</span>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Undo" disabled={!hist?.canUndo || !!busy} onClick={() => void act("undo")}><Undo2 className="size-4" /></IconButton>
            <IconButton label="Redo" disabled={!hist?.canRedo || !!busy} onClick={() => void act("redo")}><Redo2 className="size-4" /></IconButton>
            {state && <VersionMenu state={state} />}
            {state && <ThemePicker state={state} />}
            {state && <Button size="sm" variant="primary" onClick={() => setExporting(true)}><Download className="size-4" aria-hidden /> <span className="hidden sm:inline">Export</span></Button>}
            {state && <IconButton label={inspector ? "Hide details" : "Show details"} active={inspector} className="max-xl:hidden xl:grid" onClick={() => setInspector((i) => !i)}><PanelRight className="size-4" /></IconButton>}
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {state ? <Preview html={state.previewHtml} device={device} busy={!!busy} /> : (
            <div className="surface-grain grid flex-1 place-items-center bg-sunken p-6">
              <div className="max-w-sm text-center animate-rise"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-line bg-panel text-muted"><WandSparkles className="size-6" aria-hidden /></div><h2 className="font-display text-2xl">Your preview appears here</h2><p className="mt-2 text-sm leading-relaxed text-muted">Landing pages, SaaS sites, portfolios and dashboards: live, responsive, and exportable to HTML or React.</p></div>
            </div>
          )}
          {state && inspector && <Inspector state={state} />}
        </div>
      </section>
      {state && <ExportDialog open={exporting} onClose={() => setExporting(false)} designId={state.id} />}
    </div>
  );
}
