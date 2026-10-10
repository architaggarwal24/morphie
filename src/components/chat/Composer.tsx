"use client";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Mode } from "@/lib/types";
import { Kbd, cn } from "../ui";
import { ProviderChip } from "./ProviderChip";

const MAX = 20_000;

export function Composer({ mode, running, onSend, onStop, focusKey }: { mode: Mode; running: boolean; onSend: (text: string) => void; onStop: () => void; focusKey: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [focusKey, running]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(220, el.scrollHeight) + "px";
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    if (t.length > MAX) return;
    onSend(t);
    setText("");
  };
  const near = text.length > MAX * 0.8;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2">
      <div className={cn("rounded-2xl border bg-panel shadow-card transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15", "border-line")}>
        <textarea
          ref={ref} value={text} rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={mode === "agent" ? "Give the agent a task…" : "Ask anything…"}
          aria-label={mode === "agent" ? "Task for the agent" : "Message"}
          className="block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
          <ProviderChip disabled={running} />
          <div className="ml-auto flex items-center gap-3">
            {near && <span className={cn("font-mono text-[11px]", text.length > MAX ? "text-err" : "text-muted")}>{text.length.toLocaleString()}/{MAX.toLocaleString()}</span>}
            <span className="hidden text-[11px] text-faint sm:block"><Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line</span>
            {running ? (
              <button onClick={onStop} aria-label="Stop" className="grid size-9 place-items-center rounded-xl bg-fg text-bg transition hover:opacity-90"><Square className="size-3.5 fill-current" /></button>
            ) : (
              <button onClick={submit} disabled={!text.trim() || text.length > MAX} aria-label="Send" className="grid size-9 place-items-center rounded-xl bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-30"><ArrowUp className="size-[18px]" /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
