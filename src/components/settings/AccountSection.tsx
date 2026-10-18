"use client";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Badge, Button } from "../ui";

export function AccountSection() {
  const session = useStore((s) => s.session);
  const toast = useStore((s) => s.toast);

  const signOut = async (everywhere: boolean) => {
    try { await api(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST" }); location.reload(); }
    catch (e) { toast("error", (e as Error).message); }
  };

  if (!session) return null; // the app shows the sign-in screen instead of ever reaching here
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl">Account</h2>
        <p className="mt-1 max-w-xl text-sm text-muted">Your chats, documents, memories and designs belong to this account and follow you across devices.</p>
      </header>
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center gap-2"><h3 className="text-sm font-medium">Signed in</h3><Badge tone="ok">Account</Badge></div>
        <p className="text-sm text-muted">{session.user.displayName ? `${session.user.displayName} · ` : ""}<span className="text-fg">{session.user.email}</span></p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => signOut(false)}><LogOut className="size-4" aria-hidden /> Sign out</Button>
          <Button variant="ghost" onClick={() => signOut(true)}>Sign out everywhere</Button>
        </div>
      </div>
    </div>
  );
}
