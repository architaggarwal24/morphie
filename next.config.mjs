import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { fileURLToPath } from "node:url";

// Lets `next dev` use the same bindings (D1, secrets) as production via wrangler's local emulation. No-op in builds.
initOpenNextCloudflareForDev();

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["unpdf", "mammoth"],
  // Next 16 builds with Turbopack by default (reads tsconfig "paths"); Next 15 / --webpack uses the alias below.
  // Pinning the root also silences the "multiple lockfiles" warning when a parent folder has its own package-lock.json.
  turbopack: { root },
  webpack(config) {
    config.resolve.alias["@"] = path.join(root, "src");
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
