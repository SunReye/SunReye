/**
 * Rewrite root-absolute asset URLs in the adapter-static fallback page to
 * relative ones. SvelteKit deliberately emits `/_app/...` in the fallback
 * (it can't know the depth a fallback will be served from), but this app
 * uses the hash router, so the document URL is always exactly the served
 * root — `./_app/...` is always correct, and root-absolute URLs would
 * escape a path-prefixed reverse proxy (Home Assistant ingress serves the
 * app at /api/hassio_ingress/<token>/).
 *
 * Runs as part of `bun run build:static` (the addon build); the adapter-node
 * build renders HTML per-request with relative paths and doesn't need this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runtime path into the build output, not a module import; the file only exists
// after `vite build`. Assembled from segments rather than one literal so static
// analysis does not read it as a module specifier — as a literal it reports an
// unresolved import on a clean checkout and a stale suppression once someone
// has built locally, so the repo could not be audited in both states.
const page = fileURLToPath(new URL(["..", "build", "index.html"].join("/"), import.meta.url));

const html = readFileSync(page, "utf8")
  .replaceAll('"/_app/', '"./_app/')
  .replaceAll('"/favicon.svg"', '"./favicon.svg"');

// A leftover root-absolute reference means SvelteKit changed how it emits the
// fallback — fail the build instead of shipping a page that 404s under ingress.
if (html.includes('"/_app/')) {
  throw new Error("fallback page still contains root-absolute /_app/ URLs");
}

writeFileSync(page, html);
console.log("Relativized asset URLs in build/index.html");
