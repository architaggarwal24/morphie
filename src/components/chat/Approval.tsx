"use client";
import { ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { PendingApproval } from "@/lib/runState";
import { Button } from "../ui";

function preview(a: PendingApproval): { title: string; body?: string } {
  const args = a.args as Record<string, unknown>;
  if (a.tool === "workspace_write") return { title: String(args.path ?? "file"), body: typeof args.content === "string" ? (args.content.length > 900 ? args.content.slice(0, 900) + "\n…" : args.content) : undefined };
  if (a.tool === "workspace_delete") return { title: String(args.path ?? "file") };
  if (a.tool === "save_memory") return { title: String(args.fact ?? "") };
  return { title: a.reason, body: JSON.stringify(args, null, 2).slice(0, 700) };
}

export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const resolve = useStore((s) => s.resolveApproval);
  const [always, setAlways] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const p = preview(approval);
  return (
    <div className="mt-2 rounded-xl border border-warn/40 bg-warn/5 p-3.5" role="group" aria-label="Approval needed">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Allow this action?</p>
          <p className="mt-0.5 break-words text-sm text-muted">{approval.reason}</p>
          {p.body && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-sunken p-2.5 font-mono text-xs leading-relaxed">{p.body}</pre>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
        <Button ref={ref} size="sm" variant="primary" onClick={() => resolve(approval.id, true, always)}>Allow</Button>
        <Button size="sm" variant="ghost" onClick={() => resolve(approval.id, false)}>Deny</Button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="size-3.5 accent-[rgb(var(--accent))]" />
          Always allow <code className="font-mono">{approval.tool}</code>
        </label>
      </div>
    </div>
  );
}
