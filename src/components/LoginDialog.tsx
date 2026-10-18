"use client";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { TAB_LABELS, getLoginTrigger, useStore } from "@/lib/store";
import { Button, Dialog, Field, Input } from "./ui";

export const AUTH_ERRORS: Record<string, string> = {
  state_mismatch: "That login didn't start in this browser, so it was stopped. Please try again.",
  expired: "That login took too long. Please try again.",
  denied: "Login was cancelled.",
  unverified_email: "That account's email isn't verified with the provider, so it can't be used to log in.",
  provider_error: "The login provider had a problem. Please try again.",
};

/**
 * The only way in: one popup for logging in and signing up (the same step does both). A visitor sees the page and the
 * Chat tab; anything else that needs an account opens this over a dimmed, blurred, inert page. Closing it (Esc,
 * clicking outside, the X) changes nothing and returns focus to whatever opened it.
 */
export function LoginDialog() {
  const open = useStore((s) => s.loginOpen);
  const closeLogin = useStore((s) => s.closeLogin);
  const wanted = useStore((s) => s.pendingTab);
  const intro = "New here? The same step creates your account.";
  return (
    <Dialog
      open={open} onClose={closeLogin} title="Log in or sign up" width="max-w-md"
      description={wanted && wanted !== "chat" ? `Log in required to open ${TAB_LABELS[wanted]}. ${intro}` : intro}
      returnFocus={getLoginTrigger} scrimClassName="backdrop-blur-md"
    >
      <LoginForm />
    </Dialog>
  );
}

/** A link that looks like a secondary Button: one tab stop, no button nested inside an anchor. */
const PROVIDER_LINK = "inline-flex h-10 items-center justify-center rounded-xl border border-line bg-raised px-4 text-sm font-medium text-fg transition hover:border-faint/60 active:scale-[0.98]";

function LoginForm() {
  const methods = useStore((s) => s.methods);
  const boot = useStore((s) => s.boot);
  const toast = useStore((s) => s.toast);
  const saveLoginRedirect = useStore((s) => s.saveLoginRedirect);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server says about delivery: "console" (development: nothing is emailed) or "failing" (the mail server rejected the last send).
  const [delivery, setDelivery] = useState<"console" | "failing" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);
  const hadCode = useRef(false);

  // Keyboard users shouldn't have to hunt: after the code is sent focus is on the code field (autoFocus below),
  // and if they pick a different address focus goes back to the email field.
  useEffect(() => { if (sentTo) hadCode.current = true; else if (hadCode.current) emailField.current?.focus(); }, [sentTo]);

  // A failed send happens after the answer has gone out, so look again shortly: the server remembers it (about itself, not the address).
  useEffect(() => {
    if (!attempt || delivery === "console") return;
    const timers = [3500, 9000].map((ms) => setTimeout(async () => {
      try { const s = await api<{ emailDelivery?: string }>("/api/auth/session"); setDelivery(s.emailDelivery === "failing" ? "failing" : null); } catch { /* keep what we have */ }
    }, ms));
    return () => timers.forEach(clearTimeout);
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const sendCode = async (address: string) => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ resendAfterSeconds: number; delivery?: "console" | "failing" }>("/api/auth/email/request", { method: "POST", body: { email: address } });
      setSentTo(address.trim()); setWait(r.resendAfterSeconds); setCode(""); setDelivery(r.delivery ?? null); setAttempt((n) => n + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try {
      await api("/api/auth/email/verify", { method: "POST", body: { email: sentTo, code } });
    } catch (e) { setError((e as Error).message); setBusy(false); return; }
    // Signed in: load the account's data, which also closes this popup and resumes what the visitor was doing.
    await boot();
    if (useStore.getState().session) toast("ok", "Logged in.");
  };

  const noMethods = !methods.email && !methods.google && !methods.github;
  if (noMethods) {
    return <p className="text-sm text-muted">Login isn't set up on this server yet. Whoever runs it needs to turn on email codes, Google or GitHub (see the README).</p>;
  }

  return (
    <div className="space-y-5">
      {methods.email && (
        <section className="space-y-3" aria-label="Email">
          <Field label="Email address" htmlFor="login-email">
            <Input id="login-email" ref={emailField} data-autofocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={!!sentTo} onKeyDown={(e) => { if (e.key === "Enter" && !sentTo && email.includes("@") && !busy) void sendCode(email); }} />
          </Field>
          {!sentTo ? (
            <Button variant="primary" className="w-full" loading={busy} disabled={!email.includes("@")} onClick={() => sendCode(email)}><Mail className="size-4" aria-hidden /> Email me a code</Button>
          ) : (
            <div className="space-y-3">
              {delivery === "console" ? (
                <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-fg">
                  Development mode: <strong>no email is sent</strong>. The code is printed in the terminal where the server is running, on lines starting with <code className="font-mono text-[13px]">[email:dev]</code>. It's valid for 10 minutes; type it here.
                </p>
              ) : (
                <p className="text-sm text-muted">If that address can receive email, a 6-digit code is on its way. It's valid for 10 minutes. Keep this page open and type it here.</p>
              )}
              {delivery === "failing" && (
                <p role="alert" className="text-sm text-err">
                  We couldn't send the email just now. Please try again in a few minutes{methods.google || methods.github ? ", or continue with Google or GitHub below" : ""}. If you run this server, the reason is in its log.
                </p>
              )}
              <Field label="6-digit code" htmlFor="login-code">
                <Input id="login-code" autoFocus data-autofocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="font-mono tracking-widest" onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6 && !busy) void verify(); }} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={verify}>Log in</Button>
                <Button variant="ghost" disabled={wait > 0 || busy} onClick={() => sendCode(sentTo)}>{wait > 0 ? `Send again in ${wait}s` : "Send again"}</Button>
                <Button variant="ghost" onClick={() => { setSentTo(null); setCode(""); setError(null); setDelivery(null); }}>Use a different address</Button>
              </div>
            </div>
          )}
        </section>
      )}
      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      {(methods.google || methods.github) && (
        <section className={methods.email ? "space-y-2 border-t border-line pt-4" : "space-y-2"} aria-label="Other ways to log in">
          <h3 className="text-sm font-medium">{methods.email ? "Or continue with" : "Continue with"}</h3>
          <div className="flex flex-wrap gap-2">
            {/* Leaving for the provider reloads the page: keep only the tab and the draft for the way back. */}
            {methods.google && <a href="/api/auth/oauth/google/start?returnTo=/" onClick={saveLoginRedirect} className={PROVIDER_LINK}>Continue with Google</a>}
            {methods.github && <a href="/api/auth/oauth/github/start?returnTo=/" onClick={saveLoginRedirect} className={PROVIDER_LINK}>Continue with GitHub</a>}
          </div>
          <p className="text-xs text-faint">Only an email the provider has verified is accepted. The same verified email always opens the same account.</p>
        </section>
      )}
    </div>
  );
}
