import type { AgentEvent, Mode, PlanItem, SourceRef, TimelineItem, ToolStep } from "./types";

export interface PendingApproval { id: string; stepId: string; tool: string; args: Record<string, unknown>; reason: string }

/** Everything the UI shows about a reply that is currently streaming. */
export interface RunState {
  convId: string | null;
  mode: Mode;
  userMessage: string;
  /** Persisted messages with id >= this are hidden while the run replaces them (edit / regenerate). */
  truncateFrom?: number;
  status: "connecting" | "running" | "waiting" | "done" | "error";
  provider?: string;
  model?: string;
  step?: { n: number; max: number };
  answer: string;
  reasoning: string;
  timeline: TimelineItem[];
  plan?: PlanItem[];
  sources: SourceRef[];
  approvals: Record<string, PendingApproval>;
  memory: string[];
  notices: string[];
  error?: string;
  usage?: { input: number; output: number };
  stopped?: boolean;
  startedAt: number;
}

export function newRun(init: { convId: string | null; mode: Mode; userMessage: string; truncateFrom?: number; now?: number }): RunState {
  return {
    convId: init.convId, mode: init.mode, userMessage: init.userMessage, truncateFrom: init.truncateFrom, status: "connecting",
    answer: "", reasoning: "", timeline: [], sources: [], approvals: {}, memory: [], notices: [], startedAt: init.now ?? Date.now(),
  };
}

const MAX_REASONING = 12_000;

function updateStep(timeline: TimelineItem[], id: string, patch: (s: ToolStep) => ToolStep): TimelineItem[] {
  return timeline.map((it) => (it.kind === "tool" && it.step.id === id ? { kind: "tool", step: patch(it.step) } : it));
}

/** Pure reducer: fold one server event into the run state. */
export function applyEvent(run: RunState, e: AgentEvent): RunState {
  switch (e.type) {
    case "start": return { ...run, convId: e.conversationId, provider: e.provider, model: e.model, status: "running" };
    case "step": return { ...run, step: { n: e.n, max: e.max } };
    case "thinking": return { ...run, reasoning: (run.reasoning + e.delta).slice(-MAX_REASONING) };
    case "text": return { ...run, answer: run.answer + e.delta };
    case "note": return { ...run, answer: "", timeline: e.text ? [...run.timeline, { kind: "note", text: e.text }] : run.timeline };
    case "plan": return { ...run, plan: e.items };
    case "tool_start": {
      const exists = run.timeline.some((it) => it.kind === "tool" && it.step.id === e.step.id);
      const timeline = exists ? updateStep(run.timeline, e.step.id, () => e.step) : [...run.timeline, { kind: "tool" as const, step: e.step }];
      return { ...run, timeline, status: e.step.status === "waiting" ? "waiting" : "running" };
    }
    case "approval": {
      const approvals = { ...run.approvals, [e.id]: { id: e.id, stepId: e.stepId, tool: e.tool, args: e.args, reason: e.reason } };
      return { ...run, approvals, status: "waiting", timeline: updateStep(run.timeline, e.stepId, (s) => ({ ...s, status: "waiting", needsApproval: true, summary: e.reason })) };
    }
    case "tool_end": {
      const approvals = Object.fromEntries(Object.entries(run.approvals).filter(([, a]) => a.stepId !== e.stepId));
      return {
        ...run, approvals, status: Object.keys(approvals).length ? "waiting" : "running",
        timeline: updateStep(run.timeline, e.stepId, (s) => ({ ...s, status: e.status, output: e.output, error: e.error, ms: e.ms, summary: e.summary ?? s.summary })),
      };
    }
    case "sources": return { ...run, sources: e.sources };
    case "memory": return { ...run, memory: e.saved };
    case "usage": return { ...run, usage: { input: e.input, output: e.output } };
    case "notice": return { ...run, notices: [...run.notices, e.text] };
    case "error": return { ...run, error: e.message, status: "error" };
    case "done": return { ...run, status: run.status === "error" ? "error" : "done", stopped: e.stopped, approvals: {} };
    case "title": return run;
  }
}
