/**
 * Guard against a public env var frozen into the static SvelteKit build.
 *
 * adapter-static writes `_app/env.js` at BUILD time, so whatever `PUBLIC_*`
 * values exist then are shipped inside the bundle. The single-binary
 * deployment serves the dashboard same-origin and the client derives its API
 * base from the document URL — a baked `PUBLIC_SERVER_URL` (trivially picked
 * up from a developer's `apps/web/.env`) overrides that and points every API
 * call and the live socket at a hardcoded host. It works on the machine that
 * built it and nowhere else, which is why this fails the build instead.
 */

/** Every `PUBLIC_` key in an `_app/env.js` module that carries a non-empty value, sorted. */
export function bakedPublicEnv(envModule: string): string[] {
  const baked = new Set<string>();
  const pair = /['"]?(PUBLIC_[A-Z0-9_]*)['"]?\s*:\s*(['"])(.*?)\2/g;
  for (const [, key, , value] of envModule.matchAll(pair)) {
    if (value.length > 0) baked.add(key);
  }
  return [...baked].sort();
}

/**
 * Where the static build writes its env module, relative to this file.
 *
 * Assembled from segments rather than written as one literal on purpose: a
 * literal build-artifact path is read as a module specifier by static analysis,
 * which then reports an unresolved import on a clean checkout (no `build/` yet)
 * and a stale suppression once someone has built locally — green in neither
 * state. `apps/web/scripts/relativize-fallback.ts` still carries that problem.
 */
const DEFAULT_ENV_MODULE = ["..", "apps", "web", "build", "_app", "env.js"].join("/");

if (import.meta.main) {
  const target = process.argv[2] ?? new URL(DEFAULT_ENV_MODULE, import.meta.url);
  const envModule = Bun.file(target);
  const baked = (await envModule.exists()) ? bakedPublicEnv(await envModule.text()) : [];
  if (baked.length > 0) {
    console.error(
      `Static build baked public env into _app/env.js: ${baked.join(", ")}.\n` +
        "Unset them (they usually come from apps/web/.env) and rebuild — the " +
        "single-binary dashboard is same-origin and derives its API base from " +
        "the document URL.",
    );
    process.exit(1);
  }
  console.log("No public env baked into the static build");
}
