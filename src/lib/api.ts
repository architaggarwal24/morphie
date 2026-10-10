export class ApiFailure extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function failure(res: Response): Promise<ApiFailure> {
  let message = `Request failed (${res.status}).`;
  let code: string | undefined;
  try {
    const j = await res.json();
    if (j?.error) message = String(j.error);
    code = j?.code;
  } catch { /* non-JSON error body */ }
  return new ApiFailure(message, res.status, code);
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.body); }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: init.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiFailure("Couldn't reach the Morphie server. Is it still running?", 0, "network");
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** POST and consume a text/event-stream response, calling onEvent for every `data:` message. */
export async function streamSSE<T>(path: string, body: unknown, onEvent: (e: T) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiFailure("Couldn't reach the Morphie server. Is it still running?", 0, "network");
  }
  if (!res.ok) throw await failure(res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6)) as T); } catch { /* ignore malformed event */ }
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw new ApiFailure("The connection dropped while the reply was streaming.", 0, "network");
  }
}
