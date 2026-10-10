export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Set when the model produced arguments that weren't valid JSON. */
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** Tool name for role "tool" (needed by Gemini). */
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  reasoning?: string;
  usage?: { input: number; output: number };
  finishReason?: string;
}

export interface ProviderModel { id: string; label?: string }

export interface Provider {
  readonly kind: string;
  readonly label: string;
  readonly model: string;
  /** false → callers must use prompt-based tool calling. */
  readonly nativeTools: boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number, public retryable = false) {
    super(message);
  }
}
