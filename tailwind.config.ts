import type { Config } from "tailwindcss";

const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), panel: c("panel"), raised: c("raised"), sunken: c("sunken"), line: c("line"),
        fg: c("fg"), muted: c("muted"), faint: c("faint"),
        accent: c("accent"), "accent-fg": c("accent-fg"),
        ok: c("ok"), warn: c("warn"), err: c("err"), info: c("info"),
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", '"Liberation Mono"', "monospace"],
      },
      borderRadius: { xl: "14px", "2xl": "20px" },
      boxShadow: {
        pop: "0 12px 40px -12px rgb(0 0 0 / 0.35), 0 0 0 1px rgb(var(--line))",
        card: "0 1px 0 rgb(var(--line)), 0 8px 24px -16px rgb(0 0 0 / 0.25)",
      },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: "0.35" }, "50%": { opacity: "1" } },
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
      },
      animation: { "pulse-dot": "pulseDot 1.2s ease-in-out infinite", rise: "rise .28s ease-out both", shimmer: "shimmer 2.2s linear infinite" },
    },
  },
  plugins: [],
} satisfies Config;
