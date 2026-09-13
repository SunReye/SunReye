/**
 * Rewrite root-absolute static URLs in the adapter-static fallback page to
 * relative ones — see `src/lib/build/relativize-fallback.ts` for the rule and
 * the reason (hash router + Home Assistant ingress prefix).
 *
 * Runs as part of `bun run build:static` (the addon build); the adapter-node
 * build renders HTML per-request with relative paths and doesn't need this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { relativizeFallback } from "../src/lib/build/relativize-fallback";

// Runtime path into the build output, not a module import; the file only exists
// after `vite build`. Assembled from segments rather than one literal so static
// analysis does not read it as a module specifier — as a literal it reports an
// unresolved import on a clean checkout and a stale suppression once someone
// has built locally, so the repo could not be audited in both states.
const page = fileURLToPath(new URL(["..", "build", "index.html"].join("/"), import.meta.url));

writeFileSync(page, relativizeFallback(readFileSync(page, "utf8")));
console.log("Relativized static URLs in build/index.html");
