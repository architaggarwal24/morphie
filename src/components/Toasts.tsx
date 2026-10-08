"use client";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "./ui";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 md:bottom-4" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === "error" ? AlertCircle : t.kind === "ok" ? CheckCircle2 : Info;
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel p-3 pr-2 shadow-pop animate-rise", t.kind === "error" ? "border-err/40" : "border-line")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", t.kind === "error" ? "text-err" : t.kind === "ok" ? "text-ok" : "text-info")} aria-hidden />
            <p className="flex-1 text-sm leading-snug">{t.text}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="grid size-6 place-items-center rounded-md text-faint hover:text-fg"><X className="size-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}
