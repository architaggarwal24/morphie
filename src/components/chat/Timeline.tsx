"use client";
import { AlertTriangle, Brain, Calculator, Check, ChevronRight, Clock, FilePen, FileSearch, FileText, FolderOpen, Globe, ListChecks, Loader2, Palette, Search, ShieldQuestion, Trash2, Wrench, X } from "lucide-react";
import { useState } from "react";
import type { PendingApproval } from "@/lib/runState";
import { argSummary, ms, toolLabel } from "@/lib/format";
import type { PlanItem, StepStatus, TimelineItem, ToolStep } from "@/lib/types";
import { cn } from "../ui";
import { ApprovalCard } from "./Approval";

const ICONS: Record<string, typeof Wrench> = {
  calculator: Calculator, get_current_time: Clock, web_search: Search, fetch_url: Globe, search_documents: FileSearch, update_plan: ListChecks,
  workspace_list: FolderOpen, workspace_read: FileText, workspace_write: FilePen, workspace_delete: Trash2, save_memory: Brain, design_website: Palette,
};

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-accent" aria-label="Running" />;
  if (status === "waiting") return <ShieldQuestion className="size-3.5 animate-pulse-dot text-warn" aria-label="Waiting for approval" />;
  if (status === "done") return <Check className="size-3.5 text-ok" aria-label="Done" />;
  if (status === "denied") return <X className="size-3.5 text-muted" aria-label="Denied" />;
  return <AlertTriangle className="size-3.5 text-err" aria-label="Failed" />;
}

function Step({ step, approval, defaultOpen }: { step: ToolStep; approval?: PendingApproval; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const Icon = ICONS[step.name] ?? Wrench;
  const detail = step.summary || step.error || argSummary(step.args);
  const hasBody = step.output || step.error || Object.keys(step.args).length > 0;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!hasBody} className={cn("group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition", hasBody && "hover:bg-raised")}>
        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-sunken text-muted"><Icon className="size-3.5" aria-hidden /></span>
        <span className="text-sm font-medium">{toolLabel(step.name)}</span>
        {detail && <span className={cn("min-w-0 flex-1 truncate text-[13px]", step.status === "error" ? "text-err" : "text-muted")}>{detail}</span>}
        {!detail && <span className="flex-1" />}
        {step.ms != null && step.status !== "running" && <span className="shrink-0 font-mono text-[11px] text-faint">{ms(step.ms)}</span>}
        <StatusIcon status={step.status} />
        {hasBody && <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition", open && "rotate-90")} aria-hidden />}
      </button>
      {open && (
        <div className="ml-[34px] mt-1 space-y-2 pb-1 text-xs">
          {Object.keys(step.args).length > 0 && <pre className="max-h-44 overflow-auto rounded-lg border border-line bg-sunken p-2.5 font-mono leading-relaxed text-muted">{JSON.stringify(step.args, null, 2)}</pre>}
          {step.output && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-sunken p-2.5 font-mono leading-relaxed">{step.output}</pre>}
          {step.error && <p className="rounded-lg border border-err/30 bg-err/5 p-2.5 text-err">{step.error}</p>}
        </div>
      )}
      {approval && step.status === "waiting" && <div className="ml-[34px]"><ApprovalCard approval={approval} /></div>}
    </div>
  );
}

export function PlanCard({ plan }: { plan: PlanItem[] }) {
  const done = plan.filter((p) => p.status === "done").length;
  return (
    <div className="rounded-xl border border-line bg-raised/60 p-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium"><ListChecks className="size-4 text-accent" aria-hidden /> Plan</span>
        <span className="font-mono text-[11px] text-muted">{done}/{plan.length}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(done / plan.length) * 100}%` }} /></div>
      <ol className="mt-3 space-y-1.5">
        {plan.map((p, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span className={cn("mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border", p.status === "done" ? "border-ok bg-ok text-white" : p.status === "active" ? "border-accent" : "border-line")}>
              {p.status === "done" ? <Check className="size-2.5" aria-hidden /> : p.status === "active" ? <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" /> : null}
            </span>
            <span className={cn(p.status === "done" && "text-muted line-through decoration-faint/60", p.status === "active" && "font-medium")}>{p.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Timeline({ items, approvals, live, collapsible }: { items: TimelineItem[]; approvals?: Record<string, PendingApproval>; live?: boolean; collapsible?: boolean }) {
  const tools = items.filter((i) => i.kind === "tool") as Array<{ kind: "tool"; step: ToolStep }>;
  const [open, setOpen] = useState(!collapsible);
  if (!items.length) return null;
  const byStep = Object.fromEntries(Object.values(approvals ?? {}).map((a) => [a.stepId, a]));
  const failed = tools.filter((t) => t.step.status === "error").length;
  const total = tools.reduce((n, t) => n + (t.step.ms ?? 0), 0);
  return (
    <div>
      {collapsible && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mb-1 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] text-muted transition hover:text-fg">
          <ChevronRight className={cn("size-3.5 transition", open && "rotate-90")} aria-hidden />
          {tools.length} step{tools.length === 1 ? "" : "s"}{total ? ` · ${ms(total)}` : ""}{failed ? ` · ${failed} failed` : ""}
        </button>
      )}
      {open && (
        <div className="relative space-y-0.5 border-l border-line pl-3">
          {items.map((it, i) =>
            it.kind === "note" ? (
              <p key={i} className="px-2 py-1 text-[13px] italic leading-relaxed text-muted">{it.text}</p>
            ) : (
              <Step key={it.step.id} step={it.step} approval={byStep[it.step.id]} defaultOpen={live && it.step.status === "waiting"} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
