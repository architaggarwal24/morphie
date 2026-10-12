// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSection } from "@/components/settings/AccountSection";
import { useStore } from "@/lib/store";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls: Array<{ url: string; method: string; body: any }> = [];
let session: any;

beforeEach(() => {
  calls = [];
  session = { authenticated: true, isGuest: true, user: null, expiresAt: Date.now() + 86_400_000, idleExpiresAt: Date.now() + 7_200_000, methods: { email: true, google: true, github: false } };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url === "/api/auth/session") return json(session);
    if (url === "/api/auth/email/request") return json({ ok: true, expiresInMinutes: 10, resendAfterSeconds: 60 });
    if (url === "/api/auth/email/verify") return calls.at(-1)!.body.code === "123456" ? json({ ok: true }) : json({ error: "That code didn't work. Check it, or ask for a new one.", code: "invalid_code" }, 400);
    return json({ ok: true });
  }));
  vi.stubGlobal("location", { ...window.location, reload: vi.fn(), search: "", pathname: "/" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useStore.setState(useStore.getInitialState()); });

describe("Account section", () => {
  it("tells a guest their work is temporary and which sign-in methods exist", async () => {
    render(<AccountSection />);
    expect(await screen.findByText(/using Morphie as a guest/i)).toBeTruthy();
    expect(screen.getByText(/deleted when this browser session ends/i)).toBeTruthy();
    expect(screen.getByText(/does not move your current guest work/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull(); // not configured on this server
  });

  it("walks through email sign-in in the same tab: ask for a code, type it, sign in", async () => {
    const user = userEvent.setup();
    render(<AccountSection />);
    await user.type(await screen.findByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
    expect(screen.getByText(/If that address can receive email/i)).toBeTruthy(); // never says whether the address has an account
    expect(calls.find((c) => c.url === "/api/auth/email/request")!.body).toEqual({ email: "ada@example.com" });
    const verify = screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true); // needs all six digits
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(verify);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/email/verify" && c.body.code === "123456" && c.body.email === "ada@example.com")).toBe(true));
  });

  it("shows the account and offers sign out when signed in", async () => {
    session = { ...session, isGuest: false, user: { email: "ada@example.com", displayName: "Ada" } };
    const user = userEvent.setup();
    render(<AccountSection />);
    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText(/guest/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Sign out everywhere/i }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/logout-all" && c.method === "POST")).toBe(true));
  });
});
