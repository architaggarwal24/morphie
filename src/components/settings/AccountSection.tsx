"use client";
import { LogOut, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Badge, Button, Field, Input, Spinner, cn } from "../ui";

interface SessionInfo {
  authenticated: boolean;
  isGuest: boolean | null;
  user: { email: string | null; displayName: string | null } | null;
  expiresAt?: number;
  idleExpiresAt?: number;
  methods: { email: boolean; google: boolean; github: boolean };
}

const AUTH_ERRORS: Record<string, string> = {
  state_mismatch: "That sign-in didn't start in this browser, so it was stopped. Please try again.",
  expired: "That sign-in took too long. Please try again.",
  denied: "Sign-in was cancelled.",
  unverified_email: "That account's email isn't verified with the provider, so it can't be used to sign in.",
  provider_error: "The sign-in provider had a problem. Please try again.",
};

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("rounded-2xl border border-line bg-panel p-5", className)}>{children}</div>;

export function AccountSection() {
  const { toast } = useStore();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setSession(await api<SessionInfo>("/api/auth/session")); } catch (e) { toast("error", (e as Error).message); } }, [toast]);
  useEffect(() => { void load(); }, [load]);
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
    try { await api("/api/auth/email/verify", { method: "POST", body: { email: sentTo, code } }); toast("ok", "Signed in."); setTimeout(() => location.reload(), 500); }
    catch (e) { toast("error", (e as Error).message); setBusy(false); }
  };
  const signOut = async (everywhere: boolean) => {
    try { await api(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST" }); location.reload(); }
    catch (e) { toast("error", (e as Error).message); }
  };

  if (!session) return <div className="py-10"><Spinner /></div>;
  const m = session.methods;
  const noMethods = !m.email && !m.google && !m.github;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl">Account</h2>
        <p className="mt-1 max-w-xl text-sm text-muted">Sign in to keep your work across visits and devices.</p>
      </header>

      {session.authenticated && session.isGuest === false ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2"><h3 className="text-sm font-medium">Signed in</h3><Badge tone="ok">Account</Badge></div>
          <p className="text-sm text-muted">{session.user?.displayName ? `${session.user.displayName} · ` : ""}<span className="text-fg">{session.user?.email}</span></p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => signOut(false)}><LogOut className="size-4" aria-hidden /> Sign out</Button>
            <Button variant="ghost" onClick={() => signOut(true)}>Sign out everywhere</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="space-y-2 border-warn/40">
            <div className="flex items-center gap-2"><h3 className="text-sm font-medium">You're using Morphie as a guest</h3><Badge tone="warn">Temporary</Badge></div>
            <p className="text-sm leading-relaxed text-muted">
              Guest work is temporary: it's deleted when this browser session ends
              {session.idleExpiresAt ? <> (or after about {Math.max(1, Math.round((session.idleExpiresAt - Date.now()) / 60000))} more minutes without activity)</> : null}.
              Signing in does not move your current guest work into your account yet, and signing in on a different browser starts with an empty account.
            </p>
          </Card>

          {noMethods ? (
            <p className="text-sm text-muted">Sign-in isn't set up on this server.</p>
          ) : (
            <Card className="space-y-4">
              {m.email && (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4" aria-hidden /> Email me a code</h3>
                  <Field label="Email address" htmlFor="acct-email">
                    <Input id="acct-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={!!sentTo} />
                  </Field>
                  {!sentTo ? (
                    <Button variant="primary" loading={busy} disabled={!email.includes("@")} onClick={sendCode}>Send code</Button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted">If that address can receive email, a 6-digit code is on its way. It's valid for 10 minutes. Keep this tab open and type it here.</p>
                      <Field label="6-digit code" htmlFor="acct-code">
                        <Input id="acct-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="font-mono tracking-widest" />
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
              {(m.google || m.github) && (
                <div className="space-y-2 border-t border-line pt-4">
                  <h3 className="text-sm font-medium">Or continue with</h3>
                  <div className="flex flex-wrap gap-2">
                    {m.google && <a href="/api/auth/oauth/google/start?returnTo=/"><Button variant="secondary">Google</Button></a>}
                    {m.github && <a href="/api/auth/oauth/github/start?returnTo=/"><Button variant="secondary">GitHub</Button></a>}
                  </div>
                  <p className="text-xs text-faint">Only an email the provider has verified is accepted. The same verified email always opens the same account.</p>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
