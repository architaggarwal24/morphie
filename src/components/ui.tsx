"use client";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const cn = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const VARIANTS: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 shadow-xs",
  secondary: "bg-raised text-fg border border-line hover:border-faint/60",
  soft: "bg-accent/10 text-accent hover:bg-accent/15",
  ghost: "text-muted hover:text-fg hover:bg-raised",
  danger: "bg-err/10 text-err hover:bg-err/15",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; loading?: boolean }>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...p }, ref) {
  return (
    <button
      ref={ref}
      {...p}
      disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap", size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", VARIANTS[variant], className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button {...p} aria-label={label} title={label} className={cn("inline-grid place-items-center size-8 rounded-lg text-muted hover:text-fg hover:bg-raised transition disabled:opacity-40 disabled:pointer-events-none", active && "text-fg bg-raised", className)}>
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-50", checked ? "bg-accent" : "bg-line")}>
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

const field = "w-full rounded-xl border border-line bg-sunken px-3 text-sm text-fg placeholder:text-faint outline-hidden transition focus:border-accent/70 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";
export function Input({ className, ...p }: ComponentProps<"input">) { return <input {...p} className={cn(field, "h-10", className)} />; }
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...p} className={cn(field, "py-2.5 leading-relaxed resize-y", className)} />; }
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cn(field, "h-10 pr-8", className)}>{children}</select>; }

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">{label}</label>
      {children}
      {error ? <p className="text-xs text-err" role="alert">{error}</p> : hint ? <p className="text-xs text-muted leading-relaxed">{hint}</p> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "ok" | "warn" | "err" | "info"; children: ReactNode; className?: string }) {
  const tones = { neutral: "bg-sunken text-muted border-line", accent: "bg-accent/10 text-accent border-accent/20", ok: "bg-ok/10 text-ok border-ok/20", warn: "bg-warn/10 text-warn border-warn/25", err: "bg-err/10 text-err border-err/20", info: "bg-info/10 text-info border-info/20" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none", tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn("size-4 animate-spin text-muted", className)} aria-label="Loading" />; }

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-sm place-items-center gap-3 py-16 text-center animate-rise">
      {icon && <div className="grid size-12 place-items-center rounded-2xl border border-line bg-raised text-muted">{icon}</div>}
      <h3 className="font-display text-xl">{title}</h3>
      {children && <p className="text-sm leading-relaxed text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function Dialog({ open, onClose, title, description, children, width = "max-w-lg", footer, returnFocus, scrimClassName = "backdrop-blur-[2px]" }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; width?: string; footer?: ReactNode;
  /** Where focus goes when the dialog closes. Defaults to whatever had focus when it opened (some browsers don't focus a button on click, so a caller can name it). Keep it a stable function. */
  returnFocus?: () => HTMLElement | null;
  /** Replaces the default blur on the dimmed backdrop. */
  scrimClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // The latest callbacks, read from a ref so that a parent re-rendering (a toast expiring, say) with new function
  // identities never re-runs the effect below, which would snap focus back to the first field mid-typing.
  const latest = useRef({ onClose, returnFocus });
  useEffect(() => { latest.current = { onClose, returnFocus }; });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); latest.current.onClose(); }
      if (e.key === "Tab" && node) {
        const f = [...node.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const back = latest.current.returnFocus?.();
      (back?.isConnected ? back : previous)?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className={cn("absolute inset-0 bg-black/50 animate-rise", scrimClassName)} onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className={cn("relative flex max-h-[90dvh] w-full flex-col rounded-2xl bg-panel shadow-pop animate-rise", width)}>
        <header className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 id={titleId} className="font-display text-xl leading-tight">{title}</h2>
            {description && <p id={descId} className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} data-close className="-mr-2 -mt-1"><X className="size-4" /></IconButton>
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirm = "Delete", onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirm?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} width="max-w-md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button></>}>
      <div className="text-sm leading-relaxed text-muted">{body}</div>
    </Dialog>
  );
}

/** Closes a popover when clicking elsewhere or pressing Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="rgb(var(--accent))" />
      <path d="M14 46V18h6l12 17 12-17h6v28h-6V29L32 46 20 29v17z" fill="rgb(var(--accent-fg))" />
    </svg>
  );
}
