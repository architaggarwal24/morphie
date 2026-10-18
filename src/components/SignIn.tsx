"use client";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Toasts } from "./Toasts";
import { Button, Field, Input, Logo } from "./ui";

const AUTH_ERRORS: Record<string, string> = {
  state_mismatch: "That sign-in didn't start in this browser, so it was stopped. Please try again.",
  expired: "That sign-in took too long. Please try again.",
  denied: "Sign-in was cancelled.",
  unverified_email: "That account's email isn't verified with the provider, so it can't be used to sign in.",
  provider_error: "The sign-in provider had a problem. Please try again.",
};

/**
 * The whole app for someone who isn't signed in. There is no guest mode: until sign-in succeeds, nothing else is
 * shown and nothing is created for the visitor. The same flow signs up an address that has no account yet.
 */
export function SignIn() {
  const methods = useStore((s) => s.methods);
  const toast = useStore((s) => s.toast);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(location.search).get("auth_error");
    if (err) { toast("error", AUTH_ERRORS[err] ?? AUTH_ERRORS.provider_error); history.replaceState(null, "", location.pathname); }
  }, [toast]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const sendCode = async () => {
    setBusy(true);
    try {
      const r = await api<{ resendAfterSeconds: number }>("/api/auth/email/request", { method: "POST", body: { email } });
      setSentTo(email.trim()); setWait(r.resendAfterSeconds); setCode("");
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try {
      await api("/api/auth/email/verify", { method: "POST", body: { email: sentTo, code } });
      toast("ok", "Signed in.");
      // A full reload, so nothing from a previous visitor of this tab can survive in memory.
      setTimeout(() => location.reload(), 500);
    } catch (e) { toast("error", (e as Error).message); setBusy(false); }
  };

  const noMethods = !methods.email && !methods.google && !methods.github;

  return (
    <div className="surface-grain grid min-h-dvh place-items-center p-4">
      <main id="main" className="w-full max-w-sm animate-rise">
        <div className="flex flex-col items-center text-center">
          <Logo className="size-12" />
          <h1 className="mt-5 font-display text-3xl">Sign in to Morphie</h1>
          <p className="mt-2 text-sm text-muted">New here? The same step creates your account.</p>
        </div>

        {noMethods ? (
          <div className="mt-8 rounded-2xl border border-line bg-panel p-5 text-sm text-muted">
            Sign-in isn't set up on this server yet. Whoever runs it needs to turn on email codes, Google or GitHub (see the README).
          </div>
        ) : (
          <div className="mt-8 space-y-4 rounded-2xl border border-line bg-panel p-5">
            {methods.email && (
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4" aria-hidden /> Email me a code</h2>
                <Field label="Email address" htmlFor="signin-email">
                  <Input id="signin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={!!sentTo} />
                </Field>
                {!sentTo ? (
                  <Button variant="primary" className="w-full" loading={busy} disabled={!email.includes("@")} onClick={sendCode}>Send code</Button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">If that address can receive email, a 6-digit code is on its way. It's valid for 10 minutes. Keep this tab open and type it here.</p>
                    <Field label="6-digit code" htmlFor="signin-code">
                      <Input id="signin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="font-mono tracking-widest" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={verify}>Sign in</Button>
                      <Button variant="ghost" disabled={wait > 0 || busy} onClick={() => { setEmail(sentTo); void sendCode(); }}>{wait > 0 ? `Send again in ${wait}s` : "Send again"}</Button>
                      <Button variant="ghost" onClick={() => { setSentTo(null); setCode(""); }}>Use a different address</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {(methods.google || methods.github) && (
              <div className={methods.email ? "space-y-2 border-t border-line pt-4" : "space-y-2"}>
                <h2 className="text-sm font-medium">{methods.email ? "Or continue with" : "Continue with"}</h2>
                <div className="flex flex-wrap gap-2">
                  {methods.google && <a href="/api/auth/oauth/google/start?returnTo=/"><Button variant="secondary">Google</Button></a>}
                  {methods.github && <a href="/api/auth/oauth/github/start?returnTo=/"><Button variant="secondary">GitHub</Button></a>}
                </div>
                <p className="text-xs text-faint">Only an email the provider has verified is accepted. The same verified email always opens the same account.</p>
              </div>
            )}
          </div>
        )}
      </main>
      <Toasts />
    </div>
  );
}
