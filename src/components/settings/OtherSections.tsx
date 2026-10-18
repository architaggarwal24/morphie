"use client";
import { Check, Download, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useStore, type ThemePref } from "@/lib/store";
import { Badge, Button, ConfirmDialog, Field, Input, Kbd, Switch, cn } from "../ui";

const Head = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <header><h2 className="font-display text-2xl">{title}</h2>{children && <p className="mt-1 max-w-xl text-sm text-muted">{children}</p>}</header>
);
const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("rounded-2xl border border-line bg-panel p-5", className)}>{children}</div>;

export function AgentSection() {
  const { settings, setSettings, server } = useStore();
  const [temp, setTemp] = useState(settings.temperature?.toString() ?? "");
  return (
    <div className="space-y-6">
      <Head title="Chat & agent">Defaults for how Morphie answers and how much freedom the agent has.</Head>
      <Card className="space-y-5">
        <div className="flex items-start gap-4"><div className="flex-1"><div className="text-sm font-medium">Long-term memory</div><p className="mt-0.5 text-xs leading-relaxed text-muted">Remember stable facts and preferences you share (never secrets) and recall them in later conversations. Review them in the Memory tab.</p></div><Switch checked={settings.memory} onChange={(v) => setSettings({ memory: v })} label="Long-term memory" /></div>
        <Field label={`Agent step limit: ${settings.maxSteps}`} hint={`How many model/tool rounds one task may use (server cap ${server.maxAgentSteps}).`}>
          <input type="range" min={3} max={Math.min(30, server.maxAgentSteps)} value={settings.maxSteps} onChange={(e) => setSettings({ maxSteps: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" aria-label="Agent step limit" />
        </Field>
        <Field label="Approvals" hint="What the agent must ask about first.">
          <div className="grid gap-2 sm:grid-cols-3">
            {([["ask", "Risky actions"], ["always", "Every tool"], ["never", "Nothing"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setSettings({ approval: v })} aria-pressed={settings.approval === v} className={cn("rounded-xl border px-3 py-2 text-sm transition", settings.approval === v ? "border-accent/60 bg-accent/5 font-medium" : "border-line hover:border-faint/60")}>{l}</button>
            ))}
          </div>
        </Field>
        <Field label="Temperature override" htmlFor="temp" hint="Leave blank to use each provider's default. Lower is more focused; higher is more creative.">
          <div className="flex gap-2"><Input id="temp" value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" placeholder="default" className="max-w-[140px]" />
            <Button variant="secondary" onClick={() => { const n = Number(temp); setSettings({ temperature: temp.trim() === "" || !Number.isFinite(n) ? undefined : Math.min(2, Math.max(0, n)) }); }}>Apply</Button></div>
        </Field>
      </Card>
    </div>
  );
}

export function ToolsSection() {
  const { search, setSearch, tools, settings, setSettings, toast } = useStore();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { setSearch(await api<{ user: boolean; server: boolean }>("/api/settings/tavily", { method: "PUT", body: { key } })); setKey(""); toast("ok", "Web search key saved."); }
    catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => { try { setSearch(await api<{ user: boolean; server: boolean }>("/api/settings/tavily", { method: "DELETE" })); toast("ok", "Key removed."); } catch (e) { toast("error", (e as Error).message); } };
  return (
    <div className="space-y-6">
      <Head title="Tools">What Morphie can do beyond talking. The agent can use all of them; chat mode uses the read-only ones.</Head>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">Web search</h3>{search.user ? <Badge tone="ok">Your key</Badge> : search.server ? <Badge tone="ok">Server key</Badge> : <Badge tone="warn">Not set up</Badge>}</div>
        <p className="text-xs leading-relaxed text-muted">Powered by <a className="text-accent hover:underline" href="https://tavily.com" target="_blank" rel="noopener noreferrer">Tavily</a> (free tier available). Without a key, the model will tell you search isn't available.</p>
        <div className="flex gap-2">
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={search.user ? "Replace saved key" : "tvly-…"} autoComplete="off" aria-label="Tavily API key" className="font-mono" />
          <Button variant="primary" onClick={save} loading={busy} disabled={key.trim().length < 8}>Save</Button>
          {search.user && <Button variant="ghost" onClick={remove}>Remove</Button>}
        </div>
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-medium">Available tools</h3>
        <ul className="divide-y divide-line">
          {tools.map((t) => (
            <li key={t.name} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{t.label}<code className="font-mono text-[11px] font-normal text-faint">{t.name}</code>{t.risk === "confirm" && <Badge tone="warn">asks first</Badge>}{t.modes.length === 1 && <Badge>agent only</Badge>}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>
              </div>
              <Switch checked={!settings.disabledTools.includes(t.name)} label={`Enable ${t.label}`} disabled={t.name === "update_plan"} onChange={(v) => setSettings({ disabledTools: v ? settings.disabledTools.filter((x) => x !== t.name) : [...settings.disabledTools, t.name] })} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useStore();
  const opts: Array<{ v: ThemePref; label: string; icon: typeof Sun }> = [{ v: "system", label: "System", icon: Monitor }, { v: "light", label: "Paper", icon: Sun }, { v: "dark", label: "Ink", icon: Moon }];
  return (
    <div className="space-y-6">
      <Head title="Appearance">Two themes: warm paper for daytime, deep ink for night.</Head>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
        {opts.map((o) => (
          <button key={o.v} role="radio" aria-checked={theme === o.v} onClick={() => setTheme(o.v)} className={cn("relative rounded-2xl border p-4 text-left transition", theme === o.v ? "border-accent/60 shadow-card" : "border-line hover:border-faint/60")}>
            <div className={cn("mb-3 h-16 overflow-hidden rounded-lg border border-line p-2", o.v === "dark" ? "bg-[#0d0e11]" : o.v === "light" ? "bg-[#f6f3ee]" : "bg-linear-to-br/srgb from-[#f6f3ee] from-50% to-[#0d0e11] to-50%")} aria-hidden>
              <div className={cn("h-2 w-10 rounded-full", o.v === "dark" ? "bg-[#ff6b3d]" : "bg-[#d9481f]")} /><div className={cn("mt-2 h-1.5 w-16 rounded-full opacity-40", o.v === "dark" ? "bg-white" : "bg-black")} /><div className={cn("mt-1.5 h-1.5 w-12 rounded-full opacity-25", o.v === "dark" ? "bg-white" : "bg-black")} />
            </div>
            <span className="flex items-center gap-2 text-sm font-medium"><o.icon className="size-4 text-muted" aria-hidden /> {o.label}</span>
            {theme === o.v && <Check className="absolute right-3 top-3 size-4 text-accent" aria-hidden />}
          </button>
        ))}
      </div>
      <Card>
        <h3 className="mb-3 text-sm font-medium">Keyboard shortcuts</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {[["Command palette", ["Ctrl", "K"]], ["Send message", ["Enter"]], ["New line", ["Shift", "Enter"]], ["Close dialog", ["Esc"]]].map(([l, keys]) => (
            <div key={l as string} className="flex items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2"><dt className="text-muted">{l as string}</dt><dd className="flex gap-1">{(keys as string[]).map((k) => <Kbd key={k}>{k}</Kbd>)}</dd></div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

export function DataSection() {
  const { toast, version, server } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState("");
  const wipe = async () => {
    try { await api("/api/data/wipe", { method: "POST", body: { confirm: true } }); toast("ok", "Everything was deleted."); setTimeout(() => location.reload(), 600); }
    catch (e) { toast("error", (e as Error).message); }
  };
  return (
    <div className="space-y-6">
      <Head title="Data & privacy">Morphie keeps everything in a local database next to the app. Nothing is sent anywhere except to the AI provider you choose.</Head>
      <Card className="space-y-3">
        <h3 className="text-sm font-medium">What's stored</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
          <li>Provider keys and custom header values: <strong className="font-medium text-fg">AES-256-GCM encrypted</strong>, never sent back to the browser.</li>
          <li>Conversations, memories, uploaded document text, designs and agent workspace files.</li>
          <li>Private network addresses (like <code className="font-mono text-xs">localhost</code>) for providers are {server.allowPrivateUrls ? "allowed on this server (local use)" : "blocked on this server"}.</li>
        </ul>
        <a href="/api/data/export" download><Button variant="secondary" className="mt-2"><Download className="size-4" aria-hidden /> Export my data (JSON)</Button></a>
        <p className="text-xs text-faint">Exports never include API keys or header values.</p>
      </Card>
      <Card className="space-y-3 border-err/30">
        <h3 className="text-sm font-medium text-err">Delete everything</h3>
        <p className="text-sm leading-relaxed text-muted">Permanently removes your provider keys, conversations, memories, documents, designs and workspace files from this server.</p>
        <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 className="size-4" aria-hidden /> Delete all my data</Button>
      </Card>
      <p className="text-center text-xs text-faint">Morphie {version}</p>
      <ConfirmDialog open={confirm} title="Delete all data?" confirm="Delete everything" onConfirm={wipe} onClose={() => { setConfirm(false); setText(""); }}
        body={<div className="space-y-3"><p>This can't be undone. Type <strong className="font-mono text-fg">DELETE</strong> to confirm.</p><Input value={text} onChange={(e) => setText(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" /><p className={cn("text-xs", text === "DELETE" ? "text-ok" : "text-faint")}>{text === "DELETE" ? "Confirmed. Press Delete everything." : "The button works only after you type DELETE."}</p></div>} />
    </div>
  );
}
