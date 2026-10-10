import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@opennextjs/cloudflare": path.resolve(root, "tests/helpers/cf-stub.ts"), "@": path.resolve(root, "src") } },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"], testTimeout: 20000 },
});
