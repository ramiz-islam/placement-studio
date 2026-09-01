import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Default adapter config. No incremental cache is configured because nothing in
 * this app is statically revalidated — the page is a client-side studio and the
 * routes are all dynamic.
 */
export default defineCloudflareConfig();
