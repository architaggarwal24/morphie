"use client";
import { Check, Globe, KeyRound, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { ProfileView } from "@/lib/types";
import { Badge, Button, ConfirmDialog, EmptyState, cn } from "../ui";
import { ProviderDialog } from "./ProviderDialog";

interface Res { profiles: ProfileView[]; activeId: string | null }

export function ProvidersSection() {
  const { profiles, activeId, catalog, setProfiles, toast } = useStore();
  const [dialog, setDialog] = useState<{ editing: ProfileView | null; kind?: string | null } | null>(null);
  const [del, setDel] = useState<ProfileView | null>(null);

  const use = async (p: ProfileView) => { try { const r = await api<Res>(`/api/providers/${p.id}/activate`, { method: "POST", body: {} }); setProfiles(r.profiles, r.activeId); } catch (e) { toast("error", (e as Error).message); } };
  const remove = async (p: ProfileView) => { try { const r = await api<Res>(`/api/providers/${p.id}`, { method: "DELETE" }); setProfiles(r.profiles, r.activeId); toast("ok", `Removed ${p.label}.`); } catch (e) { toast("error", (e as Error).message); } };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl">AI providers</h2><p className="mt-1 max-w-xl text-sm text-muted">Connect as many as you like and switch between them from the composer. Keys are encrypted on this machine and never sent to the browser again.</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog({ editing: null, kind: "custom" })}><Globe className="size-4" aria-hidden /> OpenAI-compatible</Button>
          <Button variant="primary" onClick={() => setDialog({ editing: null })}><Plus className="size-4" aria-hidden /> Add provider</Button>
        </div>
      </header>

      {profiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/50">
          <EmptyState icon={<KeyRound className="size-5" />} title="Connect your first model" action={<Button variant="primary" onClick={() => setDialog({ editing: null })}><Plus className="size-4" aria-hidden /> Add provider</Button>}>
            OpenAI, Claude, Gemini, Mistral, OpenRouter, Groq, Ollama, LM Studio, or any OpenAI-compatible endpoint you point it at.
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {profiles.map((p) => {
            const active = p.id === activeId;
            const spec = catalog.find((c) => c.kind === p.kind);
            return (
              <li key={p.id} className={cn("flex flex-col rounded-2xl border bg-panel p-4 transition", active ? "border-accent/60 shadow-card" : "border-line")}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-sunken font-display text-lg">{p.label.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium">{p.label}</h3>{active && <Badge tone="accent"><Check className="size-3" aria-hidden /> Active</Badge>}{p.kind === "custom" && <Badge tone="info">OpenAI-compatible</Badge>}</div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted">{p.model}</p>
                    {(p.baseUrl || spec?.baseUrl) && <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={p.baseUrl ?? spec?.baseUrl}>{p.baseUrl ?? spec?.baseUrl}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1"><KeyRound className="size-3" aria-hidden /> {p.hasKey ? <span className="font-mono">{p.keyHint}</span> : "no key"}</span>
                  {p.options.streaming === false && <span>no streaming</span>}
                  {p.options.nativeTools === false && <span className="flex items-center gap-1"><Zap className="size-3" aria-hidden /> prompt-based tools</span>}
                  {p.options.extraHeaders && <span>{Object.keys(p.options.extraHeaders).length} custom header{Object.keys(p.options.extraHeaders).length === 1 ? "" : "s"}</span>}
                </div>
                <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3">
                  {!active && <Button size="sm" variant="soft" onClick={() => use(p)}>Use this</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ editing: p })}><Pencil className="size-3.5" aria-hidden /> Edit</Button>
                  <Button size="sm" variant="ghost" className="ml-auto hover:text-err" onClick={() => setDel(p)} aria-label={`Remove ${p.label}`}><Trash2 className="size-3.5" aria-hidden /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ProviderDialog open={!!dialog} onClose={() => setDialog(null)} editing={dialog?.editing ?? null} initialKind={dialog?.kind} />
      <ConfirmDialog open={!!del} title={`Remove ${del?.label}?`} body="Its saved key and settings will be erased from this machine." confirm="Remove" onConfirm={() => del && remove(del)} onClose={() => setDel(null)} />
    </div>
  );
}
