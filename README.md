# Morphie

A multi-provider AI workspace you run yourself: **Chat**, an autonomous **Agent**, a **Design studio**, **Documents** (RAG) and long-term **Memory**, all in one Next.js app with the backend built in.

- **Bring any model.** OpenAI, Anthropic, Gemini, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together, Fireworks, Cerebras, Perplexity, Ollama, LM Studio, APMIX.AI, and a fully configurable **OpenAI-compatible** option for everything else.
- **Real agent mode.** It plans, calls tools, reads the results, adapts, and pauses for your approval before doing anything that changes your files. You watch every step live.
- **Private by default.** Keys are encrypted on disk and never sent back to the browser. Everything lives in your own database (Cloudflare D1 in production).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node ≥ 22.13. Copy `.dev.vars.example` to `.dev.vars`, fill in the two secrets, and run `npm run db:migrate:local` once. On first launch you land on **Settings → Providers**: add a provider, pick a model, and you're chatting.

Production runs on Cloudflare Workers: see **Deploying to Cloudflare** below.

## Connecting any OpenAI-compatible provider

Settings → Providers → **OpenAI-compatible** (or Add provider → *OpenAI-compatible (custom)*). Everything is configured in the UI; nothing is read from environment variables.

| Field | What it does |
|---|---|
| **Preset** | Pre-fills the URL and defaults: CodeCraft API, LiteLLM, vLLM, llama.cpp, Azure OpenAI, or blank. |
| **Base URL** | Usually ends in `/v1`. Morphie appends `/chat/completions` and `/models`. |
| **API key** | Stored AES-256-GCM encrypted; shown only as `••••1234` afterwards. Leave blank for keyless local servers. |
| **Model** | Type any ID, or press **Fetch** to list the provider's models. |
| **Authentication** | `Authorization: Bearer`, `x-api-key`, `api-key` (Azure), a custom header name, or none. |
| **Extra headers** | Team/org IDs etc. Values are encrypted and never shown again. |
| **Query parameters** | e.g. `api-version` for Azure. |
| **Chat / models path** | Override `/chat/completions` and `/models` for non-standard gateways. |
| **Stream responses** | Turn off if a gateway breaks on streaming. |
| **Native tool calling** | Turn off and Morphie emulates tools with prompts, so agent mode works even on models/gateways without function calling. |
| **Temperature, Top P, max tokens, token parameter, timeout, system-prompt prefix** | Per-provider tuning. |

**Test connection** sends a one-word request and then probes tool calling, so you know up front whether agent mode will work. Example for [CodeCraft API](https://codecraftapi.com/docs/coding-agents): choose the *CodeCraft API* preset (`https://codecraftapi.com/v1`), paste your key, press **Fetch**, pick a model, **Save & use**.

You can save up to 24 providers and switch between them from the model chip in the composer or with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>.

## Agent mode

Open the **Agent** tab and describe a task. Each run is a loop of *plan → act → observe*:

1. For multi-step work the agent writes a checklist (`update_plan`) that ticks off live in the task panel.
2. It calls tools, reads results, and adapts. Commentary, tool calls (with arguments, output, timing) and approvals form a collapsible timeline.
3. Risky tools pause and ask: **Allow**, **Deny**, or **Always allow this tool**. You can also ask before *every* tool, or auto-approve everything (with a warning).
4. It stops at your **step limit** (default 15) with a forced best-effort final answer. **Stop** cancels instantly, including the upstream model call.

| Tool | Modes | Asks first |
|---|---|---|
| Calculator (safe recursive-descent parser, no `eval`) | chat, agent | no |
| Clock (any city or IANA timezone) | chat, agent | no |
| Web search (Tavily key in Settings → Tools) | chat, agent | no |
| Search documents (your uploads) | chat, agent | no |
| Read web page (public pages only; SSRF-hardened) | agent | no |
| Plan checklist | agent | no |
| Workspace list / read | agent | no |
| Workspace write / delete (sandboxed folder, 200 KB per file) | agent | **yes** |
| Save memory | agent | **yes** |
| Design a website (calls the Design agent) | agent | no |

Text returned by tools (web pages, documents, files) is wrapped as **untrusted data** and the model is told never to follow instructions inside it. Repeated identical tool calls are cut off. Files the agent writes appear in the task panel with view, download and delete.

## The other tabs

- **Chat:** streaming Markdown with code highlighting, edit-and-re-run, regenerate, searchable history grouped by date, pinning, renaming.
- **Design:** describe a site and get a validated design with live preview (desktop / tablet / mobile), tweak it in plain language ("make it darker"), undo/redo, 20-version history, 7 theme presets, and export to **HTML + CSS** or a **React (Vite)** project as a `.zip`. Previews run in a fully sandboxed iframe (no scripts).
- **Documents:** PDF, Word, text, Markdown, CSV, JSON. Indexed locally (hashed embeddings + keyword scoring; no embedding API needed) and used automatically by Chat and Agent with file-name citations.
- **Memory:** short facts saved only from what *you* say, never secrets or instruction-like text. Fully editable.
- **Settings:** providers, agent defaults, tools, theme, data export, delete-everything.

## Architecture

```
src/
  app/                 Next.js App Router: one page + /api route handlers
  components/          React UI (chat/, design/, library/, settings/, ui primitives)
  lib/                 client store (Zustand), SSE client, agent-event reducer, shared types
  middleware.ts        per-request CSP nonce
  server/
    providers/         OpenAI-compatible · Anthropic · Gemini · Ollama · prompted-tools fallback · catalog
    agent/             the plan→act→observe loop, approvals, prompts
    tools/             calculator, clock, web search, fetch_url, documents, workspace, plan, design
    design/            schema, components, themes, renderer, operations agent, versioned service, export
    rag/               loaders, chunker, local embeddings, D1 search
    memory.ts  profiles.ts  conversations.ts  settings.ts  workspace.ts
    http.ts  security.ts  crypto.ts  db.ts  sse.ts
tests/                 80 tests (providers, agent loop, API, design parity, RAG, UI flows)
```

Data lives in `./data` (`morphie.db`, `.encryption_key`, `.session_secret`, `workspace/`).

## Security model

- **Keys:** AES-256-GCM at rest; never returned by any endpoint or included in exports. Error text is scrubbed of key material.
- **Sessions:** anonymous, HMAC-signed, `HttpOnly`, `SameSite=Lax` cookie. Every row is scoped to it. There are no user accounts.
- **CSRF:** cross-origin writes are rejected (Origin / Sec-Fetch-Site check).
- **CSP:** per-request nonce with `strict-dynamic`; `frame-ancestors 'none'`; remote images are blocked and rendered as links.
- **SSRF:** `fetch_url` always blocks private ranges and re-checks every redirect. Provider URLs may be local only when `MORPHIE_ALLOW_PRIVATE_URLS=true` (local dev, for Ollama/LM Studio); it is `false` in `wrangler.jsonc`, and DNS is resolved and checked too.
- **No code execution:** nothing model- or user-provided is ever `eval`'d or run. The agent's file tools are confined to a per-user sandbox directory (no `..`, no symlinks, no dotfiles).
- **Uploads:** extension allow-list plus content sniffing, size caps, zip-bomb inspection for DOCX, content-hash de-duplication.
- **Design output:** model JSON is validated against a strict allow-listed schema, all text is escaped in HTML and JSX, and the preview is sandboxed with its own CSP.
- **Rate limits** on chat, design, uploads, provider tests.

## Configuration

See `.env.example` (reference) and `.dev.vars.example` (local). **Secrets:** `ENCRYPTION_KEY`, `SESSION_SECRET` (required), `TAVILY_API_KEY` (optional). **Vars** (in `wrangler.jsonc`): `MORPHIE_ALLOW_PRIVATE_URLS`, `MORPHIE_ALLOWED_ORIGINS`, `MORPHIE_MAX_UPLOAD_MB`, `MORPHIE_MAX_AGENT_STEPS`.

## Deploying to Cloudflare

Morphie runs as **one Cloudflare Worker** (Next.js via the OpenNext adapter) with:

| Resource | Binding | Used for |
| --- | --- | --- |
| D1 database `morphie` | `DB` | conversations, memory, provider profiles (keys encrypted), documents + embeddings, designs, **workspace files** |
| Durable Object `Coordinator` (SQLite-backed class, one instance per user) | `COORDINATOR` | pending agent approvals, "conversation busy" locks, per-design edit locks, rate limits |
| Static assets | `ASSETS` | `/_next/static` and `public/` |

```bash
npm install                                   # also refreshes package-lock.json; commit it
npx wrangler login
npx wrangler d1 create morphie                # paste the printed database_id into wrangler.jsonc
npx wrangler secret put ENCRYPTION_KEY        # openssl rand -base64 32
npx wrangler secret put SESSION_SECRET        # a different random value
npm run db:migrate:remote
npm run deploy
```

Local: `npm run dev` (Next dev with local D1) or `npm run preview` (the real Worker build in local workerd; this is the one that exercises Durable Objects).

Things to know:
- **Workers Paid is recommended.** The free plan caps subrequests/D1 queries per request (50), which a multi-step agent run can exceed.
- **Local models:** a Worker cannot reach `localhost`. To use Ollama/LM Studio from the deployed app, expose it over HTTPS (e.g. Cloudflare Tunnel) and use that public URL.
- **Do not rotate `ENCRYPTION_KEY`/`SESSION_SECRET`** once users exist: stored provider keys become unreadable and every browser gets a new identity.
- There is **no login**: identity is a browser cookie. Put Cloudflare Access in front if several people share a deployment.
- Document search loads a user's chunks into memory per query; keep per-user corpora modest (the default limits already bound this).

## Testing

```bash
npm test          # same suite, now against an in-memory SQLite that loads migrations/0001_init.sql
npm run typecheck
```

Covered: every provider wire format (mock servers), the agent loop (approvals, denial, step limit, loop guard, stop, prompt-injection wrapping, memory), the full HTTP API with cookies and CSRF, SSE streaming, byte-for-byte parity of the design engine against the original Python implementation, real PDF/DOCX ingestion, and the main UI flows (provider setup, streaming chat, approvals, sandboxed preview).

## Honest notes

- **Verified here:** the test suite, a production build, and a live run of the production server over real HTTP (CSP nonces on every script tag, incremental SSE, approvals, Stop cancelling the upstream call).
- **Not verified here:** the UI hasn't been viewed in a real browser (only through jsdom component tests), and providers were tested against mock servers that mimic each wire format, not against the live vendor APIs. Expect to adjust a CSS detail or a vendor quirk.
- **Model IDs change quickly.** Presets use conservative defaults; use **Fetch** to list what your key can actually use.
- **Fonts** are system stacks (no network needed). **Embeddings** are local hashing, good for keyword-ish retrieval and not a substitute for a neural embedding model on large corpora.
- **Data from the old Flask app is not migrated** (it kept one in-memory conversation per session, so there's little to carry over).
