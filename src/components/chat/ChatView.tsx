"use client";
import { ArrowDown, Bot, Menu, MessagesSquare, PanelRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Mode } from "@/lib/types";
import { Badge, IconButton, cn } from "../ui";
import { AgentInspector } from "./AgentInspector";
import { Composer } from "./Composer";
import { AssistantMessage, LiveMessage, UserMessage } from "./Message";

const SUGGESTIONS: Record<Mode, Array<{ title: string; prompt: string }>> = {
  chat: [
    { title: "Explain something", prompt: "Explain how a transformer language model works, then ask me three questions to check my understanding." },
    { title: "Do some maths", prompt: "What is 18% of 74,500, plus 240, divided by 7?" },
    { title: "Draft an email", prompt: "Draft a polite email declining a meeting invitation, offering two alternative times next week." },
    { title: "Check the time", prompt: "What time is it in Tokyo, London and New York right now?" },
  ],
  agent: [
    { title: "Research & report", prompt: "Research the trade-offs between SQLite and Postgres for a small self-hosted app, then save a one-page comparison to reports/sqlite-vs-postgres.md." },
    { title: "Read a page", prompt: "Read https://example.com and summarise what it says in three bullet points." },
    { title: "Plan & write", prompt: "Plan a four-week TypeScript study schedule and save it as a Markdown checklist in study/plan.md." },
    { title: "Design a site", prompt: "Design a landing page for a small specialty coffee roaster, then tell me which sections you chose and why." },
  ],
};

export function ChatView({ mode }: { mode: Mode }) {
  const convId = useStore((s) => s.activeConv[mode]);
  const allMessages = useStore((s) => (convId ? s.messages[convId] : undefined));
  const run = useStore((s) => s.run);
  const title = useStore((s) => s.conversations.find((c) => c.id === convId)?.title);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const hasProvider = useStore((s) => !!s.activeId);
  const loggedIn = useStore((s) => !!s.session);
  const setDraft = useStore((s) => s.setDraft);
  const openLogin = useStore((s) => s.openLogin);

  const live = !!run && run.mode === mode && run.convId === convId;
  const running = !!run && (run.status === "connecting" || run.status === "running" || run.status === "waiting");
  const busyElsewhere = running && !live;

  const messages = useMemo(() => {
    const list = allMessages ?? [];
    return live && run?.truncateFrom ? list.filter((m) => m.id < run.truncateFrom!) : list;
  }, [allMessages, live, run?.truncateFrom]);

  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const onScroll = () => { const el = scroller.current; if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 140); };
  useEffect(() => { if (stick && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
  useEffect(() => { setStick(true); }, [convId]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const regenerate = () => {
    const idx = messages.findIndex((m) => m === lastAssistant);
    const user = messages.slice(0, idx).reverse().find((m) => m.role === "user");
    if (user) void send(user.content, { truncateFrom: user.id });
  };
  const empty = messages.length === 0 && !live;
  const Icon = mode === "agent" ? Bot : MessagesSquare;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section className="relative flex h-full min-w-0 flex-1 flex-col" aria-label={mode === "agent" ? "Agent" : "Chat"}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-5">
          <IconButton label="Open conversations" className="md:hidden" onClick={() => toggleSidebar(true)}><Menu className="size-[18px]" /></IconButton>
          <Icon className="hidden size-4 text-muted sm:block" aria-hidden />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title ?? (mode === "agent" ? "New task" : "New chat")}</h1>
          {mode === "agent" && <Badge tone="accent" className="max-sm:hidden">Autonomous</Badge>}
          {mode === "agent" && <IconButton label={inspectorOpen ? "Hide task panel" : "Show task panel"} active={inspectorOpen} onClick={() => toggleInspector()}><PanelRight className="size-[18px]" /></IconButton>}
        </header>

        <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6">
            {empty && (
              <div className="animate-rise pt-[6vh]">
                <h2 className="font-display text-[clamp(2rem,5vw,2.9rem)] leading-[1.05] tracking-tight">
                  {mode === "agent" ? <>Hand it a task.<br /><span className="text-muted">Watch it work.</span></> : <>What shall we<br /><span className="text-muted">think through?</span></>}
                </h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
                  {mode === "agent"
                    ? "The agent plans, uses tools, checks its own results and asks before doing anything that changes your files."
                    : "Fast answers with optional tools: a calculator, the clock, web search and your documents."}
                </p>
                <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS[mode].map((s) => (
                    <button key={s.title} disabled={(loggedIn && !hasProvider) || running}
                      // A visitor can't send yet: the prompt goes into the composer and the login popup opens, so after logging in it is waiting there.
                      onClick={(e) => { if (loggedIn) void send(s.prompt); else { setDraft(mode, s.prompt); openLogin({ tab: "chat", trigger: e.currentTarget }); } }} className="group rounded-xl border border-line bg-panel p-3.5 text-left transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card disabled:opacity-50 disabled:hover:translate-y-0">
                      <div className="text-[13px] font-medium">{s.title}</div>
                      <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{s.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserMessage key={m.id} m={m} canEdit={!running} onEdit={(id, text) => send(text, { truncateFrom: id })} />
              ) : (
                <AssistantMessage key={m.id} m={m} isLast={m === lastAssistant && i === messages.length - 1} canRegenerate={m === lastAssistant && !running} onRegenerate={regenerate} />
              ),
            )}

            {live && run && (
              <>
                <div className="animate-rise"><div className="rounded-2xl border border-line bg-raised px-4 py-3"><p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{run.userMessage}</p></div></div>
                <LiveMessage run={run} />
              </>
            )}
          </div>
        </div>

        {!stick && (
          <button onClick={() => { setStick(true); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }} className="absolute bottom-28 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs shadow-pop animate-rise" aria-label="Jump to latest">
            <ArrowDown className="size-3.5" aria-hidden /> Latest
          </button>
        )}
        {busyElsewhere && <p className="mx-auto max-w-3xl px-4 pb-1 text-center text-xs text-muted">Another conversation is still running. You can start here once it finishes.</p>}
        <Composer mode={mode} running={running && live} onStop={stop} focusKey={`${mode}:${convId ?? "new"}`} />
      </section>
      {mode === "agent" && <AgentInspector convId={convId} messages={messages} />}
    </div>
  );
}
