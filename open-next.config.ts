import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Morphie has no ISR / static data cache needs: every page and API route is dynamic and per-user,
// so the default (no incremental cache) is correct. Add an R2/KV cache override here only if you
// later add cached pages. See https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig();
