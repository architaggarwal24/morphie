// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/components/App";
import { useDesign } from "@/lib/designStore";
import { useStore } from "@/lib/store";

const enc = new TextEncoder();
const initialStore = useStore.getInitialState();
const initialDesign = useDesign.getInitialState();

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});

const profile = (over = {}) => ({ id: "p1", kind: "custom", label: "Gateway", model: "gw-1", baseUrl: "https://gw.example/v1", hasKey: true, keyHint: "••••1234", options: {}, updatedAt: 1, ...over });
const catalog = [
  { kind: "openai", label: "OpenAI", blurb: "GPT models.", baseUrl: "https://api.openai.com/v1", requiresKey: true, defaultModel: "gpt-4o-mini", exampleModels: ["gpt-4o-mini"], nativeTools: true, canListModels: true, editableBaseUrl: false, group: "hosted" },
  { kind: "custom", label: "OpenAI-compatible (custom)", blurb: "Any OpenAI-style endpoint.", baseUrl: "", requiresKey: false, defaultModel: "", exampleModels: [], nativeTools: true, canListModels: true, editableBaseUrl: true, group: "custom" },
];
const presets = [
  { id: "codecraft", label: "CodeCraft API", baseUrl: "https://codecraftapi.com/v1", note: "Coding-agent gateway." },
  { id: "blank", label: "Something else", baseUrl: "", note: "Start from scratch." },
];
const tools = [
  { name: "calculator", label: "Calculator", description: "Maths.", risk: "safe", modes: ["chat", "agent"] },
  { name: "workspace_write", label: "Write file", description: "Writes files.", risk: "confirm", modes: ["agent"] },
];
const bootData = (over: Record<string, unknown> = {}) => ({
  version: "2.0.0", catalog, customPresets: presets, profiles: [], activeId: null,
  settings: { maxSteps: 15, approval: "ask", alwaysAllow: [], disabledTools: [], memory: true }, tools,
  search: { user: false, server: false }, conversations: [], server: { allowPrivateUrls: true, maxUploadMb: 10, maxAgentSteps: 30 }, ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A hand-driven SSE response so tests control exactly when events arrive. */
function sseResponse() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { ctl = c; } }), { headers: { "content-type": "text/event-stream" } });
  return { response, push: (e: object) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)), close: () => ctl.close() };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;
let handlers: Handler[] = [];
let calls: Array<{ url: string; method: string; body: any }> = [];

beforeEach(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  calls = [];
  handlers = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: any = init.body;
    try { if (typeof body === "string") body = JSON.parse(body); } catch { /* keep */ }
    calls.push({ url, method: init.method ?? "GET", body });
    for (const h of handlers) { const r = await h(url, init); if (r) return r; }
    if (url === "/api/design" && !init.method) return json({ designs: [], themes: [] });
    if (url.startsWith("/api/workspace")) return json({ files: [] });
    if (url.startsWith("/api/conversations") && !init.method) return json({ conversations: [] });
    return json({ error: `unmocked ${init.method ?? "GET"} ${url}` }, 404);
  }));
  useStore.setState(initialStore, true);
  useDesign.setState(initialDesign, true);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const withBoot = (data: object) => handlers.unshift((url) => (url === "/api/bootstrap" ? json(data) : undefined));
const nav = async (name: string) => (await screen.findAllByRole("button", { name }))[0];

describe("first run & provider setup", () => {
  it("lands on Settings → Providers when nothing is connected", async () => {
    withBoot(bootData());
    render(<App />);
    expect(await screen.findByText("Connect your first model")).toBeTruthy();
  });

  it("configures an OpenAI-compatible provider entirely from the UI and saves the right payload", async () => {
    const user = userEvent.setup();
    withBoot(bootData());
    handlers.push(
      (url, init) => (url === "/api/providers/models" ? json({ models: [{ id: "cc-fast" }, { id: "cc-pro" }], source: "live" }) : undefined),
      (url, init) => (url === "/api/providers" && init.method === "POST" ? json({ profile: profile({ label: "CodeCraft API", model: "cc-pro" }), profiles: [profile({ label: "CodeCraft API", model: "cc-pro" })], activeId: "p1" }) : undefined),
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^OpenAI-compatible$/ }));
    const dialog = await screen.findByRole("dialog");
    const d = within(dialog);

    await user.selectOptions(d.getByLabelText("Preset"), "codecraft");
    expect((d.getByLabelText("Base URL") as HTMLInputElement).value).toBe("https://codecraftapi.com/v1");
    expect((d.getByLabelText("Name") as HTMLInputElement).value).toBe("CodeCraft API");

    await user.type(d.getByLabelText("API key"), "cc-secret-key-000");
    await user.click(d.getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(d.getByText("2 models found.")).toBeTruthy());
    expect(calls.find((c) => c.url === "/api/providers/models")!.body).toMatchObject({ kind: "custom", apiKey: "cc-secret-key-000", baseUrl: "https://codecraftapi.com/v1" });

    await user.clear(d.getByLabelText("Model"));
    await user.type(d.getByLabelText("Model"), "cc-pro");

    await user.click(d.getByRole("button", { name: /Advanced connection settings/ }));
    await user.selectOptions(d.getByLabelText("Authentication style"), "x-api-key");
    await user.click(d.getByRole("button", { name: /Add header/ }));
    await user.type(d.getByLabelText("Header-Name 1"), "X-Team");
    await user.type(d.getByLabelText("value 1"), "alpha");
    await user.click(d.getByRole("button", { name: /Add parameter/ }));
    await user.type(d.getByLabelText("name 1"), "api-version");
    await user.type(d.getByLabelText("value 1", { selector: "input[type=text]" }), "2024");
    await user.click(d.getByRole("switch", { name: "Native tool calling" }));   // off → prompt-based tools
    await user.click(d.getByRole("switch", { name: "Stream responses" }));      // off
    await user.type(d.getByLabelText("Temperature"), "0.3");

    await user.click(d.getByRole("button", { name: "Save & use" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/providers" && c.method === "POST")).toBe(true));
    const saved = calls.find((c) => c.url === "/api/providers" && c.method === "POST")!.body;
    expect(saved).toMatchObject({
      kind: "custom", label: "CodeCraft API", model: "cc-pro", apiKey: "cc-secret-key-000", baseUrl: "https://codecraftapi.com/v1", activate: true,
      options: { authStyle: "x-api-key", extraHeaders: { "X-Team": "alpha" }, queryParams: { "api-version": "2024" }, nativeTools: false, streaming: false, temperature: 0.3 },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useStore.getState().activeId).toBe("p1");
  });

  it("shows the connection-test result including tool-calling status", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    handlers.push((url) => (url === "/api/providers/test" ? json({ ok: true, message: "Connected in 42 ms.", latencyMs: 42, reply: "pong", tools: "not_detected", hint: "Turn off native tool calling." }) : undefined));
    render(<App />);
    await user.click(await nav("Settings"));
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const d = within(await screen.findByRole("dialog"));
    await user.click(d.getByRole("button", { name: /Test connection/ }));
    expect(await d.findByText("Connected in 42 ms.")).toBeTruthy();
    expect(d.getByText("not detected")).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/providers/test")!.body).toMatchObject({ profileId: "p1", kind: "custom", model: "gw-1" });
  });
});

describe("chat", () => {
  it("streams a reply live, then shows the persisted conversation", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    const sse = sseResponse();
    handlers.push(
      (url, init) => (url === "/api/chat" && init.method === "POST" ? sse.response : undefined),
      (url) => (url === "/api/conversations/c1" ? json({ conversation: { id: "c1" }, messages: [{ id: 1, role: "user", content: "hello", createdAt: 1 }, { id: 2, role: "assistant", content: "Hello **world**", createdAt: 2, meta: { model: "gw-1" } }] }) : undefined),
    );
    render(<App />);
    const box = await screen.findByLabelText("Message");
    await user.type(box, "hello{Enter}");
    expect(calls.find((c) => c.url === "/api/chat")!.body).toMatchObject({ message: "hello", mode: "chat" });

    await act(async () => { sse.push({ type: "start", conversationId: "c1", mode: "chat", provider: "Gateway", model: "gw-1" }); sse.push({ type: "text", delta: "Hel" }); });
    expect(await screen.findByText("Hel")).toBeTruthy();
    expect(screen.getAllByText("hello")).toHaveLength(1);                     // the user's message is shown once, not twice
    expect(calls.some((c) => c.url === "/api/conversations/c1")).toBe(false); // and history isn't re-fetched mid-run
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();       // live controls while streaming

    await act(async () => { sse.push({ type: "text", delta: "lo" }); sse.push({ type: "title", title: "hello" }); sse.push({ type: "done", reason: "complete" }); sse.close(); });
    await waitFor(() => expect(screen.getByText("world").tagName).toBe("STRONG"));    // markdown rendered from persisted message
    expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull();
  });

  it("explains how to fix things when no provider is connected", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [], activeId: null }));
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: "Chat" }))[0]);
    expect(await screen.findByRole("button", { name: /Connect a provider/ })).toBeTruthy();
  });
});

describe("agent mode", () => {
  it("shows the live plan + step timeline and an approval card whose buttons talk to the server", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    const sse = sseResponse();
    handlers.push(
      (url, init) => (url === "/api/chat" && init.method === "POST" ? sse.response : undefined),
      (url, init) => (url === "/api/agent/approve" ? json({ ok: true }) : undefined),
      (url) => (url === "/api/conversations/a1" ? json({ conversation: { id: "a1" }, messages: [] }) : undefined),
    );
    render(<App />);
    await user.click(await nav("Agent"));
    await user.type(await screen.findByLabelText("Task for the agent"), "write a note{Enter}");
    expect(calls.find((c) => c.url === "/api/chat")!.body).toMatchObject({ mode: "agent", message: "write a note" });

    await act(async () => {
      sse.push({ type: "start", conversationId: "a1", mode: "agent", provider: "Gateway", model: "gw-1" });
      sse.push({ type: "step", n: 1, max: 15 });
      sse.push({ type: "plan", items: [{ text: "Draft the note", status: "active" }, { text: "Save it", status: "pending" }] });
      sse.push({ type: "tool_start", step: { id: "s1_0", name: "workspace_write", args: { path: "notes/a.md", content: "# Hi" }, status: "waiting", needsApproval: true } });
      sse.push({ type: "approval", id: "ap1", stepId: "s1_0", tool: "workspace_write", args: { path: "notes/a.md", content: "# Hi" }, reason: "Write notes/a.md (4 characters)" });
    });
    expect(await screen.findByText("Allow this action?")).toBeTruthy();
    expect(screen.getAllByText("Draft the note").length).toBeGreaterThan(0);          // plan card
    expect(screen.getByText("Needs your approval")).toBeTruthy();
    expect(screen.getByText("Step 1/15")).toBeTruthy();

    await user.click(screen.getByLabelText(/Always allow/));
    await user.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/agent/approve")?.body).toEqual({ id: "ap1", approved: true, always: true }));
    expect(screen.queryByText("Allow this action?")).toBeNull();

    await act(async () => { sse.push({ type: "tool_end", stepId: "s1_0", status: "done", ms: 8, summary: "Created notes/a.md" }); sse.push({ type: "text", delta: "Saved." }); sse.push({ type: "done", reason: "complete" }); sse.close(); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull());
  });

  it("lets the user deny an action", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    const sse = sseResponse();
    handlers.push((url, init) => (url === "/api/chat" && init.method === "POST" ? sse.response : undefined), (url) => (url === "/api/agent/approve" ? json({ ok: true }) : undefined));
    render(<App />);
    await user.click(await nav("Agent"));
    await user.type(await screen.findByLabelText("Task for the agent"), "delete it{Enter}");
    await act(async () => {
      sse.push({ type: "start", conversationId: "a2", mode: "agent", provider: "G", model: "m" });
      sse.push({ type: "tool_start", step: { id: "s1_0", name: "workspace_delete", args: { path: "x.md" }, status: "waiting" } });
      sse.push({ type: "approval", id: "ap9", stepId: "s1_0", tool: "workspace_delete", args: { path: "x.md" }, reason: "Delete x.md" });
    });
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/agent/approve")?.body).toEqual({ id: "ap9", approved: false, always: undefined }));
    await act(async () => { sse.push({ type: "done", reason: "complete" }); sse.close(); });
  });
});

describe("design studio", () => {
  const design = { name: "Acme", theme: { background: "#fff", surface: "#f4f4f5", primary: "#18181b", secondary: "#52525b", accent: "#2563eb", text: "#18181b" }, typography: { heading: "Inter", body: "Inter", scale: "normal" }, layout: { max_width: "1200px", spacing: "comfortable" }, style: { radius: "sm", shadow: "none" }, responsive: { tablet_columns: 2, mobile_columns: 1, mobile_nav: "collapse" }, sections: [{ id: "hero", type: "hero" }, { id: "footer", type: "footer" }] };
  const state = { id: "d1", name: "Acme", design, previewHtml: "<!DOCTYPE html><html><body><h1>Acme hero</h1></body></html>", updatedAt: 1, history: { version: 1, position: 1, total: 1, canUndo: false, canRedo: false, revision: 1 }, versions: [{ version: 1, summary: "Created Acme.", prompt: "acme", createdAt: 1, current: true }] };

  it("generates a design and renders it in a fully sandboxed iframe", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    const sse = sseResponse();
    handlers.push((url, init) => (url === "/api/design" && init.method === "POST" ? sse.response : undefined));
    render(<App />);
    await user.click(await nav("Design"));
    await user.type(await screen.findByLabelText("Design instruction"), "a landing page for acme{Enter}");
    expect(calls.find((c) => c.url === "/api/design" && c.method === "POST")!.body).toMatchObject({ message: "a landing page for acme", designId: null });
    await act(async () => { sse.push({ type: "stage", stage: "drafting", attempt: 0 }); });
    expect(await screen.findByText("Designing…")).toBeTruthy();
    await act(async () => { sse.push({ type: "result", state, changed: true, kind: "create", summary: "A clean landing page.", notes: ["adjusted theme.text"] }); sse.close(); });

    const frame = (await screen.findByTitle("Design preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");                 // empty sandbox = no scripts, no same-origin, no forms
    expect(frame.getAttribute("srcdoc")).toContain("Acme hero");
    expect(screen.getByText("A clean landing page.")).toBeTruthy();
    expect(screen.getByText("1 automatic adjustment")).toBeTruthy();
    expect(screen.getAllByText("hero").length).toBeGreaterThan(0);    // inspector outline
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K, filters, and navigates", async () => {
    const user = userEvent.setup();
    withBoot(bootData({ profiles: [profile()], activeId: "p1" }));
    render(<App />);
    await screen.findByLabelText("Message");
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByLabelText("Search commands");
    await user.type(input, "memory");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Memory" })).toBeTruthy();
  });
});
