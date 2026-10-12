import type { AgentEvent, AgentSettings, Mode, SourceRef } from "@/lib/types";
import type { Actor } from "../auth/actor";
import type { Provider } from "../providers/types";

export interface ToolContext {
  actor: Actor;
  conversationId: string;
  mode: Mode;
  signal: AbortSignal;
  settings: AgentSettings;
  provider: Provider;
  emit: (e: AgentEvent) => void;
}

export interface ToolResult {
  text: string;
  sources?: SourceRef[];
  files?: string[];
  /** One-line human summary for the timeline. */
  summary?: string;
}

export interface ToolDef {
  name: string;
  label: string;
  /** Shown to the model. */
  description: string;
  parameters: Record<string, unknown>;
  /** "confirm" tools pause for approval unless the user chose to allow them. */
  risk: "safe" | "confirm";
  modes: Mode[];
  /** Output comes from outside (web, documents): wrap it as untrusted data. */
  untrusted?: boolean;
  needsKey?: string;
  /** Plain-language description of what this call will do (shown in approval prompts). */
  describeCall?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolResult>;
}

export function str(args: Record<string, unknown>, key: string, max = 4000): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`"${key}" is required and must be text.`);
  if (v.length > max) throw new ToolError(`"${key}" is too long (max ${max} characters).`);
  return v;
}

export class ToolError extends Error {}
