/** Stand-in for "@opennextjs/cloudflare" under vitest: there is no Workers runtime, so bindings are never read. */
export function getCloudflareContext(): never {
  throw new Error("getCloudflareContext() is not available in tests. The sqlite Db and in-process coordinator are used instead.");
}
export function initOpenNextCloudflareForDev(): void {}
