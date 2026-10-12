# Morphie

A multi-provider AI workspace you run yourself: **Chat**, an autonomous **Agent**, a **Design studio**, **Documents** (RAG) and long-term **Memory**, all in one Next.js app with the backend built in.

- **Bring any model.** OpenAI, Anthropic, Gemini, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together, Fireworks, Cerebras, Perplexity, Ollama, LM Studio, APMIX.AI, and a fully configurable **OpenAI-compatible** option for everything else.
- **Real agent mode.** It plans, calls tools, reads the results, adapts, and pauses for your approval before doing anything that changes your files. You watch every step live.
- **Private by default.** Keys are encrypted on disk and never sent back to the browser. Everything lives in a local SQLite file.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node ≥ 22.13 (Morphie uses the built-in `node:sqlite`). On first launch you land on **Settings → Providers**: add a provider, pick a model, and you're chatting. No `.env` needed.

Production: `npm run build && npm start`.

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
    rag/               loaders, chunker, local embeddings, SQLite search
    memory.ts  profiles.ts  conversations.ts  settings.ts  workspace.ts
    http.ts  security.ts  crypto.ts  db.ts  sse.ts
tests/                 tests (providers, agent loop, API, sessions, login, ownership, SSRF, design parity, RAG, UI flows)
```

Data lives in `./data` (`morphie.db`, `.encryption_key`, `.session_secret`, `workspace/`).

## Security model

- **Keys:** AES-256-GCM at rest; never returned by any endpoint or included in exports. Error text is scrubbed of key material.
- **Sessions:** anonymous, HMAC-signed, `HttpOnly`, `SameSite=Lax` cookie. Every row is scoped to it. There are no user accounts.
- **CSRF:** cross-origin writes are rejected (Origin / Sec-Fetch-Site check).
- **CSP:** per-request nonce with `strict-dynamic`; `frame-ancestors 'none'`; remote images are blocked and rendered as links.
- **SSRF:** every outbound call (providers, `fetch_url`, web search, email API) goes through `guardedFetch`, which resolves the name, rejects private/loopback/link-local/IPv4-mapped/NAT64/6to4 addresses, and connects to exactly the addresses it validated, so DNS rebinding and redirects can't slip through. Provider URLs may be local only where `MORPHIE_ALLOW_PRIVATE_URLS` allows it (default: true in development, **false in production**); `fetch_url` never allows it.
- **No code execution:** nothing model- or user-provided is ever `eval`'d or run. The agent's file tools are confined to a per-user sandbox directory (no `..`, no symlinks, no dotfiles).
- **Uploads:** extension allow-list plus content sniffing, size caps, zip-bomb inspection for DOCX, content-hash de-duplication.
- **Design output:** model JSON is validated against a strict allow-listed schema, all text is escaped in HTML and JSX, and the preview is sandboxed with its own CSP.
- **Rate limits** on chat, design, uploads, provider tests.

## Accounts and sessions

- **Sessions** are opaque: the cookie holds 32 random bytes and the database stores only their SHA-256, so a leaked database can't be replayed as cookies. Over https the cookie is `__Host-morphie_session` (Secure, no Domain); over plain http (localhost) it is `morphie_session`. Always `HttpOnly; SameSite=Lax`.
- **Guests** (no sign-in) get a browser-session cookie plus a server-side idle timeout (default 120 min) and hard maximum (24 h). Signed-in sessions last up to 30 days (14 idle). Tokens are rotated on login; sign out revokes immediately; "Sign out everywhere" revokes every session of the account.
- **Every route declares who may call it** (`route({ auth: "public" | "guest" | "user" }, ...)`; leaving it out is a type error) and all SQL lives in `src/server/data/`, where every function takes an `Actor` and scopes by owner. `tests/ownership.test.ts` discovers every route file and fails on a missing declaration or a route that takes an id without a cross-user test.
- **Login methods:** an email code (6 digits, 10 minutes, single use, 5 tries, 60 s resend cooldown, stored only as a keyed hash; answers are identical for known and unknown addresses), Google, and GitHub. Accounts link **only by verified email**: an unverified provider email never creates or links anything.
- **A magic link is deliberately not offered**: it would only sign in whichever browser opens it, which breaks the "type the code in the same tab" flow that keeps a guest's session alive.
- **Not yet in this version:** signing in does not move a guest's work into the account (the guest id is remembered on the new session for that step), and guest data is not yet swept after expiry.

### Setting up sign-in

Set `MORPHIE_PUBLIC_URL` first (e.g. `https://morphie.example.com`; `http://localhost:3000` is fine for development). Redirect URIs must match exactly.

**Email codes.** Pick a transport with `MORPHIE_EMAIL_TRANSPORT`:
- `smtp`: set `MORPHIE_SMTP_URL` (for example `smtps://user:password@smtp.example.com:465`) and `MORPHIE_EMAIL_FROM`.
- `resend`: set `RESEND_API_KEY` (and verify your sending domain in Resend) and `MORPHIE_EMAIL_FROM`.
- Development only: with nothing set, codes are printed to the server console. The console transport is refused in production at startup and again when the transport is created.

**Google.** In Google Cloud Console → APIs & Services → Credentials → *Create credentials → OAuth client ID* → *Web application*. Add the authorised redirect URI `<MORPHIE_PUBLIC_URL>/api/auth/oauth/google/callback`. Configure the consent screen (scopes `openid`, `email`, `profile` are all that's requested). Put the client id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Only accounts whose email Google reports as verified can sign in.

**GitHub.** Settings → Developer settings → OAuth Apps → *New OAuth App*. Authorization callback URL: `<MORPHIE_PUBLIC_URL>/api/auth/oauth/github/callback`. Put the client id and a generated client secret in `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. The scope requested is `user:email`; Morphie uses the **verified primary** address from `/user/emails` (never the public profile email).

PKCE (S256) and a browser-bound `state` are used for both. There is no OAuth library: the flow is a small, tested module (`src/server/auth/oauth.ts`) because the commonly used one (Arctic) is marked deprecated on npm.

### Upgrading from the old anonymous cookie

Before sessions existed the browser held `morphie_uid=<id>.<signature>`. For one release Morphie accepts a still-valid one and turns it into a normal guest session for the *same* user (their data is kept), clearing the old cookie. Those users are flagged `legacy_anonymous` so a future guest sweeper will not delete their data. `SESSION_SECRET` is needed only for this check.

**Removing the shim** (the release after next): (1) in the next release set `MORPHIE_ACCEPT_LEGACY_COOKIE=false` by default and watch the `[auth] legacy cookie migrated` log line fall to zero; (2) then delete `src/server/auth/legacyCookie.ts` and the block marked `REMOVE-LEGACY-SHIM` in `src/server/http.ts`, the `acceptLegacyCookie` setting, and the legacy tests in `tests/auth.test.ts`; (3) drop `SESSION_SECRET` from the required production settings if nothing else uses it. `tests/auth.test.ts` fails if the marker spreads beyond those two files.

## Releasing

Never ship `data/` (database, keys, workspace). `npm run release:zip` builds `morphie.zip` from an allow-by-exclusion tree walk and re-checks the result; `npm run check:release -- some.zip` (or `-- --tree`) fails on `data/`, `.env*`, `*.db*`, key files, `node_modules` and `.next` at any depth.

## Configuration

See `.env.example` for every setting and its default. In production the server refuses to start without valid `ENCRYPTION_KEY` and `SESSION_SECRET`.

## Deploying later: what to know

Morphie is designed as a **single-process, local-disk** app. Before putting it on the internet:

- **Persistent disk required.** SQLite and the workspace live on the filesystem, so use a VM/container with a volume. Serverless platforms (Vercel, Lambda) won't work as-is; you'd need to swap `db.ts` for a hosted database and the workspace for object storage.
- **Run one instance.** Pending approvals, rate-limit counters and the per-conversation "busy" lock are in memory.
- **Set `ENCRYPTION_KEY` and `SESSION_SECRET`** (required in production; back them up: losing the encryption key makes stored provider keys unreadable), set **`MORPHIE_PUBLIC_URL`** and **`MORPHIE_TRUSTED_PROXY`**, and serve over https (private URLs are already off by default in production).
- **Serve over HTTPS** (the session cookie becomes `Secure` automatically behind `x-forwarded-proto: https`).
- There is **no login**. Identity is a browser cookie, so clearing cookies orphans that browser's data. Put it behind your own auth/SSO if multiple people share one deployment.

## Testing

```bash
npm test
npm run typecheck
```

Covered: every provider wire format (mock servers), the agent loop (approvals, denial, step limit, loop guard, stop, prompt-injection wrapping, memory), the full HTTP API with cookies and CSRF, SSE streaming, byte-for-byte parity of the design engine against the original Python implementation, real PDF/DOCX ingestion, and the main UI flows (provider setup, streaming chat, approvals, sandboxed preview).

## Honest notes

- **Verified here:** the test suite, a production build, and a live run of the production server over real HTTP (CSP nonces on every script tag, incremental SSE, approvals, Stop cancelling the upstream call).
- **Not verified here:** the UI hasn't been viewed in a real browser (only through jsdom component tests), and providers were tested against mock servers that mimic each wire format, not against the live vendor APIs. Expect to adjust a CSS detail or a vendor quirk.
- **Model IDs change quickly.** Presets use conservative defaults; use **Fetch** to list what your key can actually use.
- **Fonts** are system stacks (no network needed). **Embeddings** are local hashing, good for keyword-ish retrieval and not a substitute for a neural embedding model on large corpora.
- **Data from the old Flask app is not migrated** (it kept one in-memory conversation per session, so there's little to carry over).
