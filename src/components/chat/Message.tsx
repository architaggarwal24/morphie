"use client";
import { AlertCircle, Brain, Check, ChevronRight, Copy, Download, FileText, Globe, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import type { RunState } from "@/lib/runState";
import type { MessageView, SourceRef } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Badge, Button, IconButton, Textarea, cn } from "../ui";
import { Markdown } from "./Markdown";
import { PlanCard, Timeline } from "./Timeline";

function useCopy(text: string) {
  const [done, setDone] = useState(false);
  return [done, async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* blocked */ } }] as const;
}

function hostOf(url?: string) { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; } }

function Sources({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((s, i) => {
        const inner = (
          <>
            {s.url ? <Globe className="size-3 shrink-0" aria-hidden /> : <FileText className="size-3 shrink-0" aria-hidden />}
            <span className="truncate">{s.document ?? (s.title || hostOf(s.url))}</span>
            {s.url && <span className="hidden text-faint sm:inline">{hostOf(s.url)}</span>}
          </>
        );
        const cls = "flex max-w-[260px] items-center gap-1.5 rounded-lg border border-line bg-raised/60 px-2 py-1 text-xs text-muted transition hover:border-faint/60 hover:text-fg";
        return s.url ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className={cls} title={s.snippet}>{inner}</a> : <span key={i} className={cls} title={s.snippet}>{inner}</span>;
      })}
    </div>
  );
}

function Files({ files }: { files: string[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Files created">
      {files.map((f) => (
        <a key={f} href={`/api/workspace/file?path=${encodeURIComponent(f)}&download=1`} className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1 font-mono text-xs text-accent transition hover:bg-accent/10">
          <Download className="size-3" aria-hidden /> {f}
        </a>
      ))}
    </div>
  );
}

export function UserMessage({ m, canEdit, onEdit }: { m: MessageView; canEdit: boolean; onEdit: (id: number, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [copied, copy] = useCopy(m.content);
  return (
    <div className="group animate-rise">
      {editing ? (
        <div className="space-y-2 rounded-2xl border border-accent/40 bg-raised p-3">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(10, Math.max(2, draft.split("\n").length))} data-autofocus aria-label="Edit your message" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(m.content); }}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={() => { setEditing(false); onEdit(m.id, draft.trim()); }}>Save &amp; re-run</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 rounded-2xl border border-line bg-raised px-4 py-3">
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.content}</p>
          </div>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <IconButton label={copied ? "Copied" : "Copy message"} onClick={copy}>{copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}</IconButton>
            {canEdit && <IconButton label="Edit and re-run" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></IconButton>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistantMessage({ m, isLast, canRegenerate, onRegenerate }: { m: MessageView; isLast: boolean; canRegenerate: boolean; onRegenerate: () => void }) {
  const meta = m.meta;
  const [copied, copy] = useCopy(m.content);
  const hasSteps = !!meta?.timeline?.some((t) => t.kind === "tool");
  return (
    <div className="group animate-rise">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-lg bg-accent text-accent-fg"><Sparkles className="size-3.5" aria-hidden /></span>
        <span className="text-[13px] font-medium">Morphie</span>
        {meta?.model && <span className="truncate font-mono text-[11px] text-faint">{meta.model}</span>}
        {meta?.stopped && <Badge tone="warn">Stopped</Badge>}
      </div>
      <div className="space-y-3 pl-8">
        {meta?.plan && meta.plan.length > 0 && hasSteps && <PlanCard plan={meta.plan} />}
        {hasSteps && <Timeline items={meta!.timeline!} collapsible />}
        {m.content && !meta?.error && <Markdown text={m.content} />}
        {meta?.error && (
          <div className="flex items-start gap-2 rounded-xl border border-err/30 bg-err/5 p-3 text-sm text-err" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{meta.error}</span></div>
        )}
        {meta?.files && <Files files={meta.files} />}
        {meta?.sources && <Sources sources={meta.sources} />}
        {meta?.memory && meta.memory.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted"><Brain className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden /> Remembered: {meta.memory.join(" · ")}</p>
        )}
        <div className={cn("flex items-center gap-1 pt-1 transition", isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <IconButton label={copied ? "Copied" : "Copy reply"} onClick={copy}>{copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}</IconButton>
          {canRegenerate && <IconButton label="Regenerate" onClick={onRegenerate}><RotateCcw className="size-3.5" /></IconButton>}
          {meta?.usage && <span className="ml-2 font-mono text-[11px] text-faint">{meta.usage.input.toLocaleString()} in · {meta.usage.output.toLocaleString()} out</span>}
        </div>
      </div>
    </div>
  );
}

/** The reply that is being streamed right now. */
export function LiveMessage({ run }: { run: RunState }) {
  const [showThought, setShowThought] = useState(false);
  const working = run.status === "connecting" || run.status === "running" || run.status === "waiting";
  const hasSteps = run.timeline.some((t) => t.kind === "tool");
  return (
    <div className="animate-rise" aria-live="polite" aria-busy={working}>
      <div className="mb-2 flex items-center gap-2">
        <span className="relative grid size-6 place-items-center rounded-lg bg-accent text-accent-fg">
          <Sparkles className="size-3.5" aria-hidden />
          {working && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse-dot rounded-full bg-ok ring-2 ring-bg" />}
        </span>
        <span className="text-[13px] font-medium">Morphie</span>
        {run.model && <span className="truncate font-mono text-[11px] text-faint">{run.model}</span>}
        {run.step && run.mode === "agent" && working && <Badge tone="accent">Step {run.step.n}/{run.step.max}</Badge>}
        {run.status === "waiting" && <Badge tone="warn">Needs your approval</Badge>}
      </div>
      <div className="space-y-3 pl-8">
        {run.plan && run.plan.length > 0 && <PlanCard plan={run.plan} />}
        {hasSteps || run.timeline.length > 0 ? <Timeline items={run.timeline} approvals={run.approvals} live /> : null}
        {run.reasoning && (
          <div>
            <button onClick={() => setShowThought((s) => !s)} aria-expanded={showThought} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
              <ChevronRight className={cn("size-3.5 transition", showThought && "rotate-90")} aria-hidden /> Thinking{working && !run.answer ? "…" : ""}
            </button>
            {showThought && <p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap border-l border-line pl-3 text-[13px] italic leading-relaxed text-muted">{run.reasoning}</p>}
          </div>
        )}
        {run.answer ? <Markdown text={run.answer} /> : working && run.timeline.length === 0 && !run.reasoning ? <TypingDots /> : null}
        {run.error && <div className="flex items-start gap-2 rounded-xl border border-err/30 bg-err/5 p-3 text-sm text-err" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{run.error}</span></div>}
        {run.memory.length > 0 && <p className="flex items-start gap-1.5 text-xs text-muted"><Brain className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden /> Remembered: {run.memory.join(" · ")}</p>}
        {run.sources.length > 0 && <Sources sources={run.sources} />}
      </div>
    </div>
  );
}

function TypingDots() {
  return <div className="flex h-6 items-center gap-1" aria-label="Thinking">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse-dot rounded-full bg-faint" style={{ animationDelay: `${i * 0.18}s` }} />)}</div>;
}

export function useRunActions() {
  const send = useStore((s) => s.send);
  return { edit: (id: number, text: string) => send(text, { truncateFrom: id }) };
}
