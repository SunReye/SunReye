/**
 * Rewrite root-absolute static URLs in the adapter-static fallback page to
 * relative ones. SvelteKit deliberately emits `/_app/...` (and `/favicon.svg`,
 * `/manifest.webmanifest`, `/icons/...` from `%sveltekit.assets%`) in the
 * fallback — it can't know the depth a fallback will be served from — but this
 * app uses the hash router, so the document URL is always exactly the served
 * root: `./x` is always correct, and root-absolute URLs would escape a
 * path-prefixed reverse proxy (Home Assistant ingress serves the app at
 * /api/hassio_ingress/<token>/).
 *
 * Pure so the build script (`scripts/relativize-fallback.ts`) stays a thin
 * file-IO wrapper and the rewrite itself is unit-tested.
 */

/** Static roots the page may reference. Anything else root-absolute is a bug. */
const STATIC_ROOTS = ["_app/", "favicon.svg", "manifest.webmanifest", "icons/"] as const;

export function relativizeFallback(html: string): string {
  let out = html;
  for (const root of STATIC_ROOTS) {
    out = out.replaceAll(`"/${root}`, `"./${root}`);
  }

  // A leftover root-absolute reference (single-quoted, or a root we don't list)
  // means SvelteKit changed how it emits the fallback — fail the build instead of
  // shipping a page that 404s under ingress.
  const leftover = new RegExp(
    `['"]/(?:${STATIC_ROOTS.map((r) => r.replace(".", "\\.")).join("|")})[^'"]*\\.\\w+`,
  );
  if (leftover.test(out)) {
    throw new Error("fallback page still contains root-absolute static URLs");
  }
  return out;
}
