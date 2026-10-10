import { z } from "zod";
import { DesignClarification, DesignGenerationError } from "@/server/design/agent";
import { DesignStateError, catalog, handleMessage, listDesigns } from "@/server/design/service";
import { route } from "@/server/http";
import { activeProvider } from "@/server/providers/active";
import { ProviderError } from "@/server/providers/types";
import { sse } from "@/server/sse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async (c) => ({ designs: await listDesigns(c.userId), ...catalog() }));

const body = z.object({ designId: z.string().max(40).nullable().optional(), message: z.string().trim().min(1, "Describe what to design or change.").max(4000) });

/** Streams DesignEvents: progress stages, then a result (or a clarification / error). */
export const POST = route(async (c) => {
  const b = await c.body(body);
  const provider = await activeProvider(c.userId);
  return sse(c.req, async (emit, signal) => {
    try {
      const out = await handleMessage(c.userId, b.designId ?? null, b.message, provider, { signal, onProgress: (p) => emit({ type: "stage", ...p }) });
      emit({ type: "result", state: out.state, changed: out.changed, kind: out.kind, summary: out.summary, notes: out.notes });
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof DesignClarification) emit({ type: "clarify", message: e.message });
      else if (e instanceof DesignGenerationError || e instanceof ProviderError || e instanceof DesignStateError) emit({ type: "error", message: e.message });
      else { console.error("[design]", e); emit({ type: "error", message: "Something went wrong while designing." }); }
    }
  });
}, { rate: { bucket: "design", limit: 20, windowMs: 60_000 } });
