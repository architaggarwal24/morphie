import type { AgentSettings, Mode, ToolInfo } from "@/lib/types";
import { calculator } from "./calculator";
import { currentTime } from "./datetime";
import { designWebsite } from "./design";
import { saveMemory, searchDocs } from "./documents";
import { fetchUrl } from "./fetchUrl";
import { updatePlan } from "./plan";
import type { ToolDef } from "./types";
import { webSearch } from "./webSearch";
import { workspaceDelete, workspaceList, workspaceRead, workspaceWrite } from "./workspaceTools";

/** Extra tools registered by other modules (e.g. the design agent) to avoid import cycles. */
const extra: ToolDef[] = [];
export function registerTool(tool: ToolDef): void {
  if (!extra.some((t) => t.name === tool.name)) extra.push(tool);
}

export function allTools(): ToolDef[] {
  return [calculator, currentTime, webSearch, searchDocs, fetchUrl, updatePlan, workspaceList, workspaceRead, workspaceWrite, workspaceDelete, saveMemory, designWebsite, ...extra];
}

export function toolsFor(mode: Mode, settings: AgentSettings, opts: { hasDocuments: boolean }): ToolDef[] {
  return allTools().filter((t) => t.modes.includes(mode) && !settings.disabledTools.includes(t.name) && (t.name !== "search_documents" || opts.hasDocuments));
}

export function toolInfos(): ToolInfo[] {
  return allTools().map((t) => ({ name: t.name, label: t.label, description: t.description.split(/(?<=\.)\s/)[0], risk: t.risk, modes: t.modes, needsKey: t.needsKey }));
}

export function needsApproval(tool: ToolDef, settings: AgentSettings): boolean {
  if (tool.name === "update_plan") return false;
  if (settings.approval === "never") return false;
  if (settings.alwaysAllow.includes(tool.name)) return false;
  if (settings.approval === "always") return true;
  return tool.risk === "confirm";
}
