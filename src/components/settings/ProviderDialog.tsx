"use client";
import { Check, ChevronRight, Eye, EyeOff, ExternalLink, Loader2, Plus, RefreshCw, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { AuthStyle, ModelInfo, ProfileView, ProviderOptions, ProviderSpecView } from "@/lib/types";
import { Badge, Button, Dialog, Field, Input, Select, Switch, Textarea, cn } from "../ui";

interface Row { k: string; v: string }
interface TestReport { ok: boolean; message: string; latencyMs?: number; reply?: string; tools?: string; hint?: string }

const AUTH_STYLES: Array<{ v: AuthStyle; label: string; hint: string }> = [
  { v: "bearer", label: "Authorization: Bearer <key>", hint: "The OpenAI standard. Most providers use this." },
  { v: "x-api-key", label: "x-api-key: <key>", hint: "Used by Anthropic-style gateways and some proxies." },
  { v: "api-key", label: "api-key: <key>", hint: "Used by Azure OpenAI." },
  { v: "header", label: "Custom header name…", hint: "Send the key in a header you name." },
  { v: "none", label: "No authentication", hint: "For local servers that don't need a key." },
];

const toRows = (o?: Record<string, string>): Row[] => Object.entries(o ?? {}).map(([k, v]) => ({ k, v }));
const fromRows = (rows: Row[], keepBlankValues: boolean): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.k.trim() && (keepBlankValues || r.v !== "")) out[r.k.trim()] = r.v;
  return Object.keys(out).length ? out : undefined;
};
const num = (s: string): number | undefined => { const n = Number(s); return s.trim() !== "" && Number.isFinite(n) ? n : undefined; };

function KeyValueRows({ rows, onChange, keyPlaceholder, valuePlaceholder, addLabel, secretValues, editing }: { rows: Row[]; onChange: (r: Row[]) => void; keyPlaceholder: string; valuePlaceholder: string; addLabel: string; secretValues?: boolean; editing?: boolean }) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input value={r.k} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder={keyPlaceholder} aria-label={`${keyPlaceholder} ${i + 1}`} className="font-mono text-[13px]" autoCapitalize="off" spellCheck={false} />
          <Input value={r.v} type={secretValues ? "password" : "text"} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder={editing && secretValues ? "unchanged" : valuePlaceholder} aria-label={`${valuePlaceholder} ${i + 1}`} className="font-mono text-[13px]" autoComplete="off" spellCheck={false} />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove row" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-raised hover:text-err"><X className="size-4" /></button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, { k: "", v: "" }])}><Plus className="size-3.5" aria-hidden /> {addLabel}</Button>
    </div>
  );
}

function ToggleRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-line p-3">
      <div className="flex-1"><div className="text-[13px] font-medium">{title}</div><p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p></div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function ProviderDialog({ open, onClose, editing, initialKind }: { open: boolean; onClose: () => void; editing: ProfileView | null; initialKind?: string | null }) {
  const { catalog, customPresets, setProfiles, toast, server } = useStore();
  const [kind, setKind] = useState<string | null>(null);

  useEffect(() => { if (open) setKind(editing?.kind ?? initialKind ?? null); }, [open, editing, initialKind]);
  const spec = catalog.find((c) => c.kind === kind);

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Edit ${editing.label}` : spec ? `Connect ${spec.label}` : "Add a provider"} description={!spec ? "Pick a service. Your key stays on this machine, encrypted." : spec.blurb} width={spec ? "max-w-2xl" : "max-w-3xl"}>
      {!spec ? <Picker catalog={catalog} onPick={setKind} /> : (
        <ProviderForm key={`${editing?.id ?? "new"}:${spec.kind}`} spec={spec} editing={editing} presets={customPresets} allowPrivate={server.allowPrivateUrls}
          onBack={editing ? undefined : () => setKind(null)}
          onSaved={(profiles, activeId, label) => { setProfiles(profiles, activeId); toast("ok", `${label} is ready.`); onClose(); }} />
      )}
    </Dialog>
  );
}

function Picker({ catalog, onPick }: { catalog: ProviderSpecView[]; onPick: (k: string) => void }) {
  const groups: Array<[string, ProviderSpecView["group"]]> = [["Bring your own endpoint", "custom"], ["Hosted", "hosted"], ["Gateways", "gateway"], ["Run locally", "local"]];
  return (
    <div className="space-y-6">
      {groups.map(([title, g]) => {
        const items = catalog.filter((c) => c.group === g);
        if (!items.length) return null;
        return (
          <section key={g}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((c) => (
                <button key={c.kind} onClick={() => onPick(c.kind)} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card", g === "custom" ? "border-accent/40 bg-accent/5 sm:col-span-2" : "border-line hover:border-faint/60")}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-sunken font-display text-base">{c.label.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium">{c.label}{!c.requiresKey && g !== "custom" && <Badge>no key</Badge>}</span><span className="mt-0.5 block text-xs leading-snug text-muted">{c.blurb}</span></span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProviderForm({ spec, editing, presets, allowPrivate, onBack, onSaved }: { spec: ProviderSpecView; editing: ProfileView | null; presets: Array<{ id: string; label: string; baseUrl: string; note: string; options?: Record<string, unknown> }>; allowPrivate: boolean; onBack?: () => void; onSaved: (p: ProfileView[], activeId: string | null, label: string) => void }) {
  const isCustom = spec.kind === "custom";
  const o = editing?.options ?? {};
  const [label, setLabel] = useState(editing?.label ?? (isCustom ? "" : spec.label));
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? (spec.editableBaseUrl ? spec.baseUrl : ""));
  const [model, setModel] = useState(editing?.model ?? spec.defaultModel);
  const [preset, setPreset] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const [authStyle, setAuthStyle] = useState<AuthStyle>(o.authStyle ?? (spec.requiresKey || isCustom ? "bearer" : "none"));
  const [authHeaderName, setAuthHeaderName] = useState(o.authHeaderName ?? "");
  const [headers, setHeaders] = useState<Row[]>(toRows(o.extraHeaders));
  const [query, setQuery] = useState<Row[]>(toRows(o.queryParams));
  const [chatPath, setChatPath] = useState(o.chatPath ?? "");
  const [modelsPath, setModelsPath] = useState(o.modelsPath ?? "");
  const [streaming, setStreaming] = useState(o.streaming !== false);
  const [nativeTools, setNativeTools] = useState(o.nativeTools !== false && spec.nativeTools);
  const [temperature, setTemperature] = useState(o.temperature?.toString() ?? "");
  const [topP, setTopP] = useState(o.topP?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(o.maxTokens?.toString() ?? "");
  const [tokenParam, setTokenParam] = useState<"max_tokens" | "max_completion_tokens">(o.tokenParam ?? "max_tokens");
  const [systemPrompt, setSystemPrompt] = useState(o.systemPrompt ?? "");
  const [timeoutSec, setTimeoutSec] = useState(o.timeoutSec?.toString() ?? "");

  const [models, setModels] = useState<ModelInfo[]>(spec.exampleModels.map((id) => ({ id })));
  const [modelsState, setModelsState] = useState<{ loading: boolean; note?: string; error?: string }>({ loading: false });
  const [test, setTest] = useState<TestReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFetched = useRef(false);

  const options = useMemo((): ProviderOptions => {
    const out: ProviderOptions = {};
    if (isCustom) {
      out.authStyle = authStyle;
      if (authStyle === "header") out.authHeaderName = authHeaderName.trim();
      const h = fromRows(headers, true); if (h) out.extraHeaders = h;
      const q = fromRows(query, true); if (q) out.queryParams = q;
      if (chatPath.trim()) out.chatPath = chatPath.trim();
      if (modelsPath.trim()) out.modelsPath = modelsPath.trim();
      out.streaming = streaming;
      out.nativeTools = nativeTools;
      out.tokenParam = tokenParam;
      if (systemPrompt.trim()) out.systemPrompt = systemPrompt;
      const t = num(timeoutSec); if (t !== undefined) out.timeoutSec = Math.round(t);
      const p = num(topP); if (p !== undefined) out.topP = p;
    }
    const temp = num(temperature); if (temp !== undefined) out.temperature = temp;
    const mt = num(maxTokens); if (mt !== undefined) out.maxTokens = Math.round(mt);
    return out;
  }, [isCustom, authStyle, authHeaderName, headers, query, chatPath, modelsPath, streaming, nativeTools, tokenParam, systemPrompt, timeoutSec, topP, temperature, maxTokens]);

  const payload = () => ({ profileId: editing?.id, kind: spec.kind, apiKey: apiKey.trim() || undefined, baseUrl: spec.editableBaseUrl ? baseUrl.trim() : undefined, options });

  function applyPreset(id: string) {
    setPreset(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setBaseUrl(p.baseUrl);
    if (!label.trim() && id !== "blank") setLabel(p.label);
    const po = (p.options ?? {}) as ProviderOptions;
    setAuthStyle(po.authStyle ?? "bearer");
    setQuery(toRows(po.queryParams));
    setModels([]); setModelsState({ loading: false });
    autoFetched.current = false;
  }

  async function fetchModels(silent = false) {
    if (spec.editableBaseUrl && !baseUrl.trim()) { if (!silent) setModelsState({ loading: false, error: "Enter the base URL first." }); return; }
    if (spec.requiresKey && !apiKey.trim() && !editing?.hasKey) { if (!silent) setModelsState({ loading: false, error: "Enter your API key first." }); return; }
    setModelsState({ loading: true });
    try {
      const r = await api<{ models: ModelInfo[]; source: string; warning?: string }>("/api/providers/models", { method: "POST", body: payload() });
      setModels(r.models);
      const ids = r.models.map((m) => m.id);
      if (!ids.includes(model)) {
        const pick = ids.find((i) => !/embed|whisper|tts|moderation|dall|image|rerank|guard/i.test(i));
        if (!model.trim() && pick) setModel(pick);
      }
      setModelsState({ loading: false, note: r.warning ?? `${r.models.length} models found.` });
    } catch (e) {
      setModelsState({ loading: false, error: silent ? undefined : e instanceof ApiFailure ? e.message : "Couldn't load models." });
    }
  }

  async function runTest() {
    setTesting(true); setTest(null); setError(null);
    try { setTest(await api<TestReport>("/api/providers/test", { method: "POST", body: { ...payload(), model: model.trim(), label } })); }
    catch (e) { setTest({ ok: false, message: e instanceof Error ? e.message : "Test failed." }); }
    finally { setTesting(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!model.trim()) { setError("Choose or type a model ID."); return; }
    setSaving(true);
    try {
      const r = await api<{ profile: ProfileView; profiles: ProfileView[]; activeId: string | null }>("/api/providers", {
        method: "POST", body: { id: editing?.id, kind: spec.kind, label: label.trim() || undefined, model: model.trim(), apiKey: apiKey.trim() || undefined, baseUrl: spec.editableBaseUrl ? baseUrl.trim() : undefined, options, activate: true },
      });
      onSaved(r.profiles, r.activeId, r.profile.label);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save."); }
    finally { setSaving(false); }
  }

  const keyBlurFetch = () => { if (!autoFetched.current && spec.canListModels && apiKey.trim() && (!spec.editableBaseUrl || baseUrl.trim())) { autoFetched.current = true; void fetchModels(true); } };
  const currentPreset = presets.find((p) => p.id === preset);
  const http = baseUrl.trim().startsWith("http://");

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      {onBack && <button type="button" onClick={onBack} className="-mt-1 flex items-center gap-1 text-xs text-muted hover:text-fg"><ChevronRight className="size-3 rotate-180" aria-hidden /> All providers</button>}

      {isCustom && !editing && (
        <Field label="Start from a preset" hint={currentPreset?.note ?? "Fills in the URL and sensible defaults. You can change everything afterwards."}>
          <Select value={preset} onChange={(e) => applyPreset(e.target.value)} aria-label="Preset">
            <option value="">Choose a preset…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      )}

      {(isCustom || spec.kind === "ollama" || spec.kind === "lmstudio") && (
        <Field label="Name" htmlFor="pf-label" hint="How this provider appears in the model switcher."><Input id="pf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={isCustom ? "e.g. CodeCraft API" : spec.label} maxLength={60} /></Field>
      )}

      {spec.editableBaseUrl && (
        <Field label="Base URL" htmlFor="pf-url" hint={isCustom ? <>Usually ends in <code className="font-mono">/v1</code>. Morphie adds <code className="font-mono">/chat/completions</code> and <code className="font-mono">/models</code> itself.</> : undefined}>
          <Input id="pf-url" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); autoFetched.current = false; }} placeholder="https://api.example.com/v1" inputMode="url" spellCheck={false} autoCapitalize="off" className="font-mono text-[13px]" />
          {http && !allowPrivate && <p className="mt-1 text-xs text-warn">Plain http:// sends your key unencrypted. Use https:// for remote providers.</p>}
        </Field>
      )}

      {(spec.requiresKey || isCustom || spec.kind === "ollama") && (
        <Field label={isCustom ? "API key" : spec.requiresKey ? "API key" : "API key (optional)"} htmlFor="pf-key" hint={<>{editing?.hasKey ? `Saved (${editing.keyHint}). Leave blank to keep it.` : isCustom ? "Leave blank if the endpoint needs no key." : spec.kind === "ollama" ? "Only for Ollama Cloud. Local Ollama needs none." : "Stored encrypted on this machine and never shown again."}{spec.keyUrl && <> <a href={spec.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">Get a key <ExternalLink className="size-3" aria-hidden /></a></>}</>}>
          <div className="relative">
            <Input id="pf-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} onBlur={keyBlurFetch} placeholder={editing?.hasKey ? "••••••••••••" : "sk-…"} autoComplete="off" spellCheck={false} autoCapitalize="off" className="pr-10 font-mono text-[13px]" />
            <button type="button" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? "Hide key" : "Show key"} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-fg">{showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
        </Field>
      )}

      <Field label="Model" htmlFor="pf-model" error={modelsState.error} hint={modelsState.note ?? (isCustom ? "Fetch the list from your provider, or type any model ID." : "Pick one or type any model ID.")}>
        <div className="flex gap-2">
          <Input id="pf-model" list="pf-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model-id" spellCheck={false} autoCapitalize="off" className="font-mono text-[13px]" />
          <datalist id="pf-models">{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
          {spec.canListModels && <Button type="button" variant="secondary" onClick={() => fetchModels()} loading={modelsState.loading} aria-label="Fetch models"><RefreshCw className="size-4" aria-hidden /> <span className="hidden sm:inline">Fetch</span></Button>}
        </div>
      </Field>

      <div className="rounded-xl border border-line">
        <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
          <ChevronRight className={cn("size-4 text-muted transition", advanced && "rotate-90")} aria-hidden /> Advanced {isCustom ? "connection settings" : "options"}
          <span className="ml-auto text-xs font-normal text-muted">{isCustom ? "auth, headers, paths, streaming, tools" : "sampling"}</span>
        </button>
        {advanced && (
          <div className="space-y-5 border-t border-line p-4">
            {isCustom && (
              <>
                <Field label="Authentication" hint={AUTH_STYLES.find((a) => a.v === authStyle)?.hint}>
                  <Select value={authStyle} onChange={(e) => setAuthStyle(e.target.value as AuthStyle)} aria-label="Authentication style">{AUTH_STYLES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}</Select>
                </Field>
                {authStyle === "header" && <Field label="Header name" htmlFor="pf-hn"><Input id="pf-hn" value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="X-Gateway-Key" className="font-mono text-[13px]" spellCheck={false} /></Field>}
                <Field label="Extra headers" hint="Sent with every request (team IDs, org headers…). Values are encrypted and never shown again.">
                  <KeyValueRows rows={headers} onChange={setHeaders} keyPlaceholder="Header-Name" valuePlaceholder="value" addLabel="Add header" secretValues editing={!!editing} />
                </Field>
                <Field label="Query parameters" hint="Appended to every URL, e.g. api-version for Azure.">
                  <KeyValueRows rows={query} onChange={setQuery} keyPlaceholder="name" valuePlaceholder="value" addLabel="Add parameter" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Chat path" htmlFor="pf-cp" hint="Default /chat/completions"><Input id="pf-cp" value={chatPath} onChange={(e) => setChatPath(e.target.value)} placeholder="/chat/completions" className="font-mono text-[13px]" spellCheck={false} /></Field>
                  <Field label="Models path" htmlFor="pf-mp" hint="Default /models"><Input id="pf-mp" value={modelsPath} onChange={(e) => setModelsPath(e.target.value)} placeholder="/models" className="font-mono text-[13px]" spellCheck={false} /></Field>
                </div>
                <ToggleRow title="Stream responses" hint="Show text as it's written. Turn off if your gateway breaks on streaming." checked={streaming} onChange={setStreaming} />
                <ToggleRow title="Native tool calling" hint="The model calls tools through the API's function-calling. If agent mode misbehaves, turn this off and Morphie will use prompt-based tools instead." checked={nativeTools} onChange={setNativeTools} />
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Temperature" htmlFor="pf-t" hint="Blank = provider default"><Input id="pf-t" value={temperature} onChange={(e) => setTemperature(e.target.value)} inputMode="decimal" placeholder="default" /></Field>
              {isCustom && <Field label="Top P" htmlFor="pf-p" hint="Blank = default"><Input id="pf-p" value={topP} onChange={(e) => setTopP(e.target.value)} inputMode="decimal" placeholder="default" /></Field>}
              <Field label="Max output tokens" htmlFor="pf-m" hint="Blank = default"><Input id="pf-m" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} inputMode="numeric" placeholder="default" /></Field>
            </div>
            {isCustom && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Token limit parameter" hint="Newer OpenAI-style APIs want max_completion_tokens."><Select value={tokenParam} onChange={(e) => setTokenParam(e.target.value as typeof tokenParam)}><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></Select></Field>
                <Field label="Timeout (seconds)" htmlFor="pf-to" hint="Default 90"><Input id="pf-to" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} inputMode="numeric" placeholder="90" /></Field>
              </div>
            )}
            {isCustom && <Field label="System prompt prefix" htmlFor="pf-sp" hint="Added in front of Morphie's own instructions for this provider only."><Textarea id="pf-sp" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} maxLength={4000} placeholder="Optional" /></Field>}
          </div>
        )}
      </div>

      {test && (
        <div role="status" className={cn("rounded-xl border p-3.5 text-sm", test.ok ? "border-ok/40 bg-ok/5" : "border-err/40 bg-err/5")}>
          <div className={cn("flex items-start gap-2 font-medium", test.ok ? "text-ok" : "text-err")}>{test.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}<span>{test.message}</span></div>
          {test.ok && test.reply && <p className="mt-1 pl-6 text-xs text-muted">Model said: “{test.reply}”</p>}
          {test.ok && test.tools && test.tools !== "skipped" && (
            <p className="mt-1 flex items-center gap-1.5 pl-6 text-xs text-muted"><Zap className="size-3" aria-hidden /> Tool calling: {test.tools === "supported" ? <Badge tone="ok">works</Badge> : test.tools === "prompted" ? <Badge tone="info">prompt-based</Badge> : <Badge tone="warn">not detected</Badge>}</p>
          )}
          {test.hint && <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted">{test.hint}</p>}
        </div>
      )}
      {error && <p className="rounded-xl border border-err/40 bg-err/5 p-3 text-sm text-err" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={runTest} disabled={testing || !model.trim()}>{testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" aria-hidden />} Test connection</Button>
        <Button type="submit" variant="primary" loading={saving}>{editing ? "Save changes" : "Save & use"}</Button>
      </div>
    </form>
  );
}
