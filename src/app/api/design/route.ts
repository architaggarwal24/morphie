import { z } from "zod";
import { DesignClarification, DesignGenerationError } from "@/server/design/agent";
import { DesignStateError, catalog, handleMessage, listDesigns, requireDesign } from "@/server/design/service";
import { route } from "@/server/http";
import { activeProvider } from "@/server/providers/active";
import { ProviderError } from "@/server/providers/types";
import { sse } from "@/server/sse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route({ auth: "guest" }, async (c) => ({ designs: listDesigns(c.actor), ...catalog() }));

const body = z.object({ designId: z.string().max(40).nullable().optional(), message: z.string().trim().min(1, "Describe what to design or change.").max(4000) });

/** Streams DesignEvents: progress stages, then a result (or a clarification / error). */
export const POST = route({ auth: "guest", rate: { bucket: "design", limit: 20, windowMs: 60_000 } }, async (c) => {
  const b = await c.body(body);
  if (b.designId) requireDesign(c.actor, b.designId); // someone else's design is a 404 before the stream starts
  const provider = await activeProvider(c.actor);
  return sse(c.req, async (emit, signal) => {
    try {
      const out = await handleMessage(c.actor, b.designId ?? null, b.message, provider, { signal, onProgress: (p) => emit({ type: "stage", ...p }) });
      emit({ type: "result", state: out.state, changed: out.changed, kind: out.kind, summary: out.summary, notes: out.notes });
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof DesignClarification) emit({ type: "clarify", message: e.message });
      else if (e instanceof DesignGenerationError || e instanceof ProviderError || e instanceof DesignStateError) emit({ type: "error", message: e.message });
      else { console.error("[design]", e); emit({ type: "error", message: "Something went wrong while designing." }); }
    }
  });
});
