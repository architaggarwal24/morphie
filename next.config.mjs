import path from "node:path";
import { fileURLToPath } from "node:url";
import { allHeaders } from "./security-headers.mjs";

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
    return allHeaders({ production: process.env.NODE_ENV === "production" });
  },
};
export default nextConfig;
