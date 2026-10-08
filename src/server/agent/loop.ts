import type { AgentEvent, AgentSettings, AssistantMeta, Mode, PlanItem, SourceRef, TimelineItem, ToolStep } from "@/lib/types";
import { LIMITS } from "../config";
import { addMessage, getConversation, getMessages, setTitle, titleFrom, updateMessageMeta } from "../conversations";
import { formatMemoriesForPrompt, rememberFromTurn, searchMemories } from "../memory";
import { ProviderError, type ChatMessage, type Provider } from "../providers/types";
import { hasDocuments } from "../rag";
import { saveSettings } from "../settings";
import { needsApproval, toolsFor } from "../tools";
import { ToolError, type ToolContext, type ToolDef, type ToolResult } from "../tools/types";
import { requestApproval } from "./approvals";
import { LAST_STEP_NOTICE, systemPrompt, wrapUntrusted } from "./prompts";

export interface RunInput {
  userId: string;
  conversationId: string;
  mode: Mode;
  message: string;
  provider: Provider;
  settings: AgentSettings;
  signal: AbortSignal;
  emit: (e: AgentEvent) => void;
  /** Regenerate: the user message is already stored. */
  skipUserSave?: boolean;
}

const HISTORY_CHAR_BUDGET = 24_000;
const MAX_REASONING = 6000;
const CHAT_MAX_STEPS = 6;

function historyFor(userId: string, conversationId: string): ChatMessage[] {
  const rows = getMessages(userId, conversationId, LIMITS.maxHistoryMessages);
  const out: ChatMessage[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  for (let i = rows.length - 1; i >= 0 && budget > 0; i--) {
    const r = rows[i];
    let content = r.content;
    if (r.role === "assistant" && r.meta?.files?.length) content += `\n\n[Files written in that turn: ${r.meta.files.join(", ")}]`;
    if (!content.trim()) continue;
    if (content.length > budget) {
      if (out.length) break;
      content = content.slice(0, budget);
    }
    out.unshift({ role: r.role, content });
    budget -= content.length;
  }
  return out;
}

function stepId(n: number, i: number): string {
  return `s${n}_${i}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + `\n…[truncated ${text.length - max} characters]` : text;
}

function normalize(res: string | ToolResult): ToolResult {
  return typeof res === "string" ? { text: res } : res;
}

export async function runAgent(input: RunInput): Promise<void> {
  const { userId, conversationId, mode, provider, signal, emit } = input;
  const settings = input.settings;
  const maxSteps = Math.max(2, mode === "agent" ? settings.maxSteps : CHAT_MAX_STEPS);
  const conv = getConversation(userId, conversationId);
  if (!conv) { emit({ type: "error", message: "That conversation no longer exists.", code: "not_found" }); return; }

  const prior = historyFor(userId, conversationId);
  if (!input.skipUserSave) addMessage(conversationId, "user", input.message);

  const docs = hasDocuments(userId);
  const memories = settings.memory ? searchMemories(userId, input.message, 5) : [];
  const system = systemPrompt(mode, {
    date: new Date().toLocaleDateString("en-GB", { dateStyle: "full" }),
    maxSteps, memoryBlock: formatMemoriesForPrompt(memories), hasDocuments: docs,
  });
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...prior, { role: "user", content: input.message }];

  const tools = toolsFor(mode, settings, { hasDocuments: docs });
  const registry = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));
  const specs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

  const timeline: TimelineItem[] = [];
  const sources: SourceRef[] = [];
  const files: string[] = [];
  let plan: PlanItem[] | undefined;
  let reasoning = "";
  let usage = { input: 0, output: 0 };
  let finalText = "";
  let stopped = false;
  let errorMessage: string | undefined;
  let reason: "complete" | "max_steps" | "aborted" | "error" = "complete";
  const seen = new Map<string, number>();

  const ctxEmit = (e: AgentEvent) => {
    if (e.type === "plan") plan = e.items;
    emit(e);
  };
  const ctx: ToolContext = { userId, conversationId, mode, signal, settings, provider, emit: ctxEmit };

  emit({ type: "start", conversationId, mode, provider: provider.label, model: provider.model });

  try {
    for (let n = 1; n <= maxSteps; n++) {
      if (signal.aborted) throw new ProviderError("Stopped.");
      emit({ type: "step", n, max: maxSteps });
      const last = n === maxSteps;
      if (last && n > 1) messages.push({ role: "user", content: LAST_STEP_NOTICE });

      let streamed = "";
      const result = await provider.chat({
        messages, signal, temperature: settings.temperature,
        tools: last && n > 1 ? undefined : specs.length ? specs : undefined,
        onText: (d) => { streamed += d; emit({ type: "text", delta: d }); },
        onReasoning: (d) => {
          if (reasoning.length < MAX_REASONING) reasoning += d;
          emit({ type: "thinking", delta: d });
        },
      });
      if (result.usage) { usage = { input: usage.input + result.usage.input, output: usage.output + result.usage.output }; }
      if (result.reasoning && !reasoning) reasoning = result.reasoning.slice(0, MAX_REASONING);

      if (!result.toolCalls.length || (last && n > 1)) {
        finalText = result.content || streamed;
        if (!finalText.trim()) {
          finalText = "";
          errorMessage = "The model returned an empty reply. Try again, or pick a different model.";
        }
        if (last && n > 1 && result.toolCalls.length) reason = "max_steps";
        else if (last && plan?.some((p) => p.status !== "done")) reason = "max_steps";
        break;
      }

      // The model is calling tools: whatever it said first is commentary, not the answer.
      const commentary = (result.content || streamed).trim();
      if (commentary) { timeline.push({ kind: "note", text: commentary }); emit({ type: "note", text: commentary }); }
      else emit({ type: "note", text: "" });
      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });

      for (const [i, call] of result.toolCalls.entries()) {
        if (signal.aborted) throw new ProviderError("Stopped.");
        const id = stepId(n, i);
        const tool = registry.get(call.name);
        const step: ToolStep = { id, name: call.name, args: call.arguments, status: "running" };
        const sig = `${call.name}:${JSON.stringify(call.arguments)}`;
        const started = Date.now();
        const finish = (status: ToolStep["status"], text: string, extra: { summary?: string; error?: string } = {}) => {
          step.status = status;
          step.ms = Date.now() - started;
          step.output = status === "done" ? clip(text, 2000) : undefined;
          step.error = extra.error;
          step.summary = extra.summary;
          emit({ type: "tool_end", stepId: id, status, output: step.output, error: extra.error, ms: step.ms, summary: extra.summary });
        };
        const reply = (text: string) => messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: text });

        timeline.push({ kind: "tool", step });
        if (!tool) {
          emit({ type: "tool_start", step });
          const msg = `Unknown tool "${call.name}". Available tools: ${[...registry.keys()].join(", ") || "none"}.`;
          finish("error", msg, { error: msg }); reply(`Error: ${msg}`); continue;
        }
        if (call.error) {
          emit({ type: "tool_start", step });
          finish("error", call.error, { error: call.error }); reply(`Error: ${call.error} Send valid JSON arguments.`); continue;
        }
        const count = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, count);
        if (count > 2) {
          emit({ type: "tool_start", step });
          const msg = "You already made this exact call twice. Use the earlier result or take a different approach.";
          finish("error", msg, { error: msg }); reply(`Error: ${msg}`); continue;
        }

        const approval = needsApproval(tool, settings);
        step.needsApproval = approval;
        if (approval) {
          step.status = "waiting";
          emit({ type: "tool_start", step });
          const req = requestApproval(userId, signal);
          emit({ type: "approval", id: req.id, stepId: id, tool: tool.name, args: call.arguments, reason: tool.describeCall?.(call.arguments) ?? `Run ${tool.label}` });
          const decision = await req.decision;
          if (signal.aborted) throw new ProviderError("Stopped.");
          if (!decision.approved) {
            finish("denied", "", { error: "You declined this action." });
            reply("The user denied this action. Do not try it again. Continue without it or explain what you couldn't do.");
            continue;
          }
          if (decision.always && !settings.alwaysAllow.includes(tool.name)) {
            ctx.settings = saveSettings(userId, { alwaysAllow: [...settings.alwaysAllow, tool.name] });
            settings.alwaysAllow = ctx.settings.alwaysAllow;
          }
          step.status = "running";
          emit({ type: "tool_start", step });
        } else {
          emit({ type: "tool_start", step });
        }

        try {
          const out = normalize(await tool.run(call.arguments, ctx));
          if (out.sources) for (const s of out.sources) if (!sources.some((x) => x.url && x.url === s.url && x.title === s.title)) sources.push(s);
          if (out.files) for (const f of out.files) if (!files.includes(f)) files.push(f);
          const text = clip(out.text, LIMITS.toolOutputChars);
          finish("done", out.text, { summary: out.summary });
          reply(tool.untrusted ? wrapUntrusted(tool.name, text) : text);
        } catch (e) {
          if (signal.aborted) throw new ProviderError("Stopped.");
          const msg = e instanceof ToolError ? e.message : "The tool failed unexpectedly.";
          if (!(e instanceof ToolError)) console.error(`[tool:${tool.name}]`, e);
          finish("error", msg, { error: msg });
          reply(`Error: ${msg}`);
        }
      }
    }
  } catch (e) {
    if (signal.aborted) { stopped = true; reason = "aborted"; }
    else {
      reason = "error";
      errorMessage = e instanceof ProviderError ? e.message : "Something went wrong while running the model.";
      if (!(e instanceof ProviderError)) console.error("[agent]", e);
      emit({ type: "error", message: errorMessage });
    }
  }

  // If we were stopped mid-tool, mark any still-running steps.
  for (const item of timeline) if (item.kind === "tool" && (item.step.status === "running" || item.step.status === "waiting")) item.step.status = "error", item.step.error = "Stopped before finishing.";

  const meta: AssistantMeta = {
    timeline: timeline.length ? timeline : undefined,
    plan, sources: sources.length ? sources.slice(0, 12) : undefined, files: files.length ? files : undefined,
    reasoning: reasoning || undefined, provider: provider.label, model: provider.model,
    usage: usage.input || usage.output ? usage : undefined, stopped: stopped || undefined, error: errorMessage,
  };
  if (!finalText && stopped) finalText = "";
  const savedContent = finalText || (stopped ? "*Stopped.*" : errorMessage ? `*${errorMessage}*` : "");
  let messageId: number | null = null;
  if (savedContent || timeline.length) messageId = addMessage(conversationId, "assistant", savedContent, meta);

  if (sources.length) emit({ type: "sources", sources: sources.slice(0, 12) });
  if (usage.input || usage.output) emit({ type: "usage", ...usage });
  if (conv.title === "New conversation") {
    const title = titleFrom(input.message);
    setTitle(conversationId, title);
    emit({ type: "title", title });
  }
  emit({ type: "done", stopped: stopped || undefined, reason });

  if (settings.memory && finalText && !stopped && reason !== "error") {
    const saved = await rememberFromTurn(userId, provider, input.message, finalText, signal);
    if (saved.length) {
      emit({ type: "memory", saved });
      if (messageId) updateMessageMeta(messageId, { ...meta, memory: saved });
    }
  }
}
