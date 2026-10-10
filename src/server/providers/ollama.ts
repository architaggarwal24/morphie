import type { ChatMessage, ChatRequest, ChatResult, Provider, ProviderModel, ToolCall } from "./types";
import { ProviderError } from "./types";
import { providerFetch, readLines, ThinkFilter } from "./util";

const TIMEOUT = 180_000; // local models can be slow to load

export class OllamaProvider implements Provider {
  readonly kind = "ollama";
  readonly label = "Ollama";
  readonly nativeTools = true;
  constructor(private cfg: { baseUrl: string; model: string; apiKey?: string }) {}
  get model(): string { return this.cfg.model; }
  private get base(): string { return this.cfg.baseUrl.replace(/\/+$/, ""); }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`; // Ollama Cloud
    return h;
  }

  private convert(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        return { role: "assistant", content: m.content, tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) };
      }
      if (m.role === "tool") return { role: "tool", content: m.content, tool_name: m.name };
      return { role: m.role, content: m.content };
    });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = { model: this.model, messages: this.convert(req.messages), stream: true };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (req.maxTokens) options.num_predict = req.maxTokens;
    if (Object.keys(options).length) body.options = options;

    let opened;
    try {
      opened = await providerFetch(`${this.base}/api/chat`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }, {
        timeoutMs: TIMEOUT, signal: req.signal, label: "Ollama", secrets: [this.cfg.apiKey],
      });
    } catch (e) {
      if (e instanceof ProviderError && e.status === undefined && /Couldn't reach/.test(e.message)) {
        throw new ProviderError(`Couldn't reach Ollama at ${this.base}. Is it running? (start it with "ollama serve")`, undefined, true);
      }
      throw e;
    }
    const filter = new ThinkFilter(req.onText, req.onReasoning);
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    let usage: ChatResult["usage"];
    let finish: string | undefined;
    for await (const line of readLines(opened, TIMEOUT)) {
      if (!line.trim()) continue;
      let j: any;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new ProviderError(`Ollama: ${String(j.error).slice(0, 300)}`);
      const msg = j.message;
      if (msg?.thinking) { reasoning += msg.thinking; req.onReasoning?.(msg.thinking); }
      if (msg?.content) filter.push(msg.content);
      for (const tc of msg?.tool_calls ?? []) {
        toolCalls.push({ id: `call_${Date.now().toString(36)}_${toolCalls.length}`, name: tc.function?.name, arguments: tc.function?.arguments ?? {} });
      }
      if (j.done) {
        finish = j.done_reason;
        usage = { input: j.prompt_eval_count ?? 0, output: j.eval_count ?? 0 };
      }
    }
    filter.end();
    return { content: filter.text, toolCalls: toolCalls.filter((c) => c.name), reasoning: (reasoning + filter.reasoning) || undefined, usage, finishReason: finish };
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const opened = await providerFetch(`${this.base}/api/tags`, { headers: this.headers() }, {
      timeoutMs: 15_000, signal, label: "Ollama", secrets: [this.cfg.apiKey], retries: 0,
    });
    const json: any = await opened.res.json();
    return (json.models ?? []).map((m: any) => ({ id: m.name }));
  }
}
