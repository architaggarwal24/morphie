// Types shared by the browser and the server. Keep this file free of server-only imports.

/** Which sign-in methods this server offers (the same flow signs people in and signs new ones up). */
export interface LoginMethods { email: boolean; google: boolean; github: boolean }

/** The signed-in session as /api/bootstrap reports it. Anonymous visitors get `session: null` instead. */
export interface SessionView {
  user: { email: string | null; displayName: string | null };
  expiresAt: number;
  idleExpiresAt: number;
}

export type ProviderKind =
  | "openai" | "anthropic" | "gemini" | "mistral" | "ollama" | "openrouter" | "groq"
  | "deepseek" | "xai" | "together" | "fireworks" | "cerebras" | "perplexity"
  | "apmixai" | "lmstudio" | "custom";

export type AuthStyle = "bearer" | "x-api-key" | "api-key" | "header" | "none";

/** Everything the "OpenAI-compatible" form can configure. All fields are optional on the wire. */
export interface ProviderOptions {
  authStyle?: AuthStyle;
  /** Header name when authStyle is "header". */
  authHeaderName?: string;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  chatPath?: string;
  modelsPath?: string;
  streaming?: boolean;
  /** false → Morphie falls back to prompt-based tool calling. */
  nativeTools?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** "max_completion_tokens" for newer OpenAI-style APIs; defaults to "max_tokens". */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  systemPrompt?: string;
  timeoutSec?: number;
}

export interface ProfileView {
  id: string;
  kind: ProviderKind;
  label: string;
  model: string;
  baseUrl?: string;
  hasKey: boolean;
  keyHint?: string;
  options: ProviderOptions;
  updatedAt: number;
}

export interface ProviderSpecView {
  kind: ProviderKind;
  label: string;
  blurb: string;
  baseUrl: string;
  requiresKey: boolean;
  defaultModel: string;
  exampleModels: string[];
  nativeTools: boolean;
  canListModels: boolean;
  editableBaseUrl: boolean;
  keyUrl?: string;
  group: "hosted" | "gateway" | "local" | "custom";
}

export interface ModelInfo { id: string; label?: string }

export type Mode = "chat" | "agent";

export interface ConversationView {
  id: string;
  title: string;
  mode: Mode;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ------------------------------------------------------------ agent events

export type StepStatus = "running" | "done" | "error" | "denied" | "waiting";

export interface PlanItem { text: string; status: "pending" | "active" | "done" }

export interface SourceRef { title: string; url?: string; snippet?: string; document?: string }

/** One tool invocation as shown in the timeline. */
export interface ToolStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: StepStatus;
  output?: string;
  error?: string;
  ms?: number;
  needsApproval?: boolean;
  summary?: string;
}

/** One row in the agent timeline: either a short note from the model or a tool call. */
export type TimelineItem =
  | { kind: "note"; text: string }
  | { kind: "tool"; step: ToolStep };

export type AgentEvent =
  | { type: "start"; conversationId: string; mode: Mode; provider: string; model: string }
  | { type: "step"; n: number; max: number }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  /** The text streamed so far this step was commentary, not the answer: move it to the timeline. */
  | { type: "note"; text: string }
  | { type: "plan"; items: PlanItem[] }
  | { type: "tool_start"; step: ToolStep }
  | { type: "approval"; id: string; stepId: string; tool: string; args: Record<string, unknown>; reason: string }
  | { type: "tool_end"; stepId: string; status: StepStatus; output?: string; error?: string; ms: number; summary?: string }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "memory"; saved: string[] }
  | { type: "title"; title: string }
  | { type: "usage"; input: number; output: number }
  | { type: "notice"; text: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; stopped?: boolean; reason?: "complete" | "max_steps" | "aborted" | "error" };

/** What is stored in messages.meta for assistant messages. */
export interface AssistantMeta {
  timeline?: TimelineItem[];
  plan?: PlanItem[];
  sources?: SourceRef[];
  memory?: string[];
  reasoning?: string;
  provider?: string;
  model?: string;
  usage?: { input: number; output: number };
  stopped?: boolean;
  error?: string;
  files?: string[];
}

export interface MessageView {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta?: AssistantMeta;
  createdAt: number;
}

export interface AgentSettings {
  maxSteps: number;
  /** ask = confirm risky tools; always = confirm every tool; never = auto-approve everything. */
  approval: "ask" | "always" | "never";
  /** Tool names the user has chosen to always allow. */
  alwaysAllow: string[];
  /** Tool names turned off entirely. */
  disabledTools: string[];
  memory: boolean;
  temperature?: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxSteps: 15,
  approval: "ask",
  alwaysAllow: [],
  disabledTools: [],
  memory: true,
};

export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  risk: "safe" | "confirm";
  modes: Mode[];
  needsKey?: string;
}

export interface MemoryView { id: string; content: string; category: string; source: string; createdAt: number; updatedAt: number }

export interface DocumentView { id: string; name: string; kind: string; size: number; chunkCount: number; createdAt: number }

export interface DesignSummary { id: string; name: string; updatedAt: number; version: number; versions: number }

// ------------------------------------------------------------------ design

export interface DesignHistoryState { version: number; position: number; total: number; canUndo: boolean; canRedo: boolean; revision: number }
export interface DesignVersionView { version: number; summary: string; prompt: string; createdAt: number; current: boolean }
export interface DesignSection { id: string; type: string; [key: string]: unknown }
export interface DesignJson {
  name: string;
  theme: Record<string, string>;
  typography: { heading: string; body: string; scale: string };
  layout: { max_width: string; spacing: string };
  style: { radius: string; shadow: string };
  responsive: { tablet_columns: number; mobile_columns: number; mobile_nav: string };
  sections: DesignSection[];
}
export interface DesignState {
  id: string;
  name: string;
  design: DesignJson;
  previewHtml: string;
  history: DesignHistoryState;
  versions: DesignVersionView[];
  updatedAt: number;
}
export interface DesignThemeView { id: string; name: string; description: string; colors: Record<string, string> }
export type DesignEvent =
  | { type: "stage"; stage: "drafting" | "validating" | "repairing"; attempt: number }
  | { type: "result"; state: DesignState; changed: boolean; kind: "create" | "edit" | "theme"; summary: string; notes: string[] }
  | { type: "clarify"; message: string }
  | { type: "error"; message: string };
