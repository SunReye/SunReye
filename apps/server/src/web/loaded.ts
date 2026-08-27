/**
 * The SvelteKit build this binary serves.
 *
 * `bun build --compile --asset ../web/build` embeds the whole tree, so there is
 * no container format and no generated import list: index and bytes are the
 * build's own files. Bun keeps only the directory's BASENAME, flattening the
 * path it was given — `apps/web/build` arrives as `build/…`, which is why
 * `ASSET_DIR` is a bare name and not a path.
 *
 * Two sources, one shape. The compiled binary reads `Bun.embeddedFiles`; under
 * `bun run` that array is empty, so dev and the test suite walk the build on
 * disk instead. `embedded.ts` used to get this for free — a
 * `with { type: "file" }` import resolves to the real file when uncompiled —
 * and directory embedding gives that up, so the fallback is explicit.
 *
 * Path resolution and cache policy are NOT here: see ./static-assets.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Basename of the directory handed to `--asset`, and the prefix every embedded
 * name therefore carries.
 */
const ASSET_DIR = "build";

/** What `Bun.embeddedFiles` yields: a blob that knows its packed name. */
export type EmbeddedFile = Blob & { readonly name: string };

/**
 * The URL path an embedded name answers, or `null` when the name is not part of
 * the build. Anything else a binary happens to embed must not become a route.
 */
function assetKey(embeddedName: string): string | null {
  const prefix = `${ASSET_DIR}/`;
  if (!embeddedName.startsWith(prefix)) return null;
  const relative = embeddedName.slice(prefix.length);
  return relative === "" ? null : `/${relative}`;
}

async function assetsFromEmbedded(
  files: readonly EmbeddedFile[],
): Promise<Map<string, Uint8Array>> {
  const assets = new Map<string, Uint8Array>();
  for (const file of files) {
    const key = assetKey(file.name);
    if (key === null) continue;
    assets.set(key, new Uint8Array(await file.arrayBuffer()));
  }
  return assets;
}

/**
 * The build read from `dir`. A missing directory yields nothing rather than
 * throwing: a clone that never ran the web build lands here, and it should 404
 * assets, not fail to boot.
 */
function assetsFromDisk(dir: string): Map<string, Uint8Array> {
  const assets = new Map<string, Uint8Array>();

  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return assets;
  }

  for (const relative of entries) {
    const at = join(dir, relative);
    // A recursive listing includes directories, and reading one throws.
    if (statSync(at).isDirectory()) continue;
    assets.set(`/${relative}`, new Uint8Array(readFileSync(at)));
  }
  return assets;
}

/**
 * Where to look for the build on disk, or `null` when there is no disk worth
 * looking at.
 *
 * A compiled binary bundles every module into bun's virtual filesystem, so the
 * path relative to THIS module escapes to an absolute host path (`/web/build`).
 * A stray directory there must never become the dashboard — an API-only binary
 * serves no dashboard at all, and says so by getting `null`.
 */
// fallow-ignore-next-line unused-export -- the compiled-vs-source decision, asserted by loaded.test.ts; test files aren't traced as consumers
export function diskBuildDir(moduleDir: string): string | null {
  if (moduleDir.startsWith("/$bunfs/")) return null;
  return join(moduleDir, "../../../web/build");
}

/**
 * Embedded build if there is one, else the build in `diskDir`.
 *
 * The embedded array wins whenever it holds anything: a compiled binary must
 * never prefer whatever happens to sit on the host's filesystem.
 */
// fallow-ignore-next-line unused-export -- the seam both asset sources are asserted through by loaded.test.ts; test files aren't traced as consumers
export async function resolveAssets(
  embedded: readonly EmbeddedFile[],
  diskDir: string | null,
): Promise<Map<string, Uint8Array>> {
  const fromEmbedded = await assetsFromEmbedded(embedded);
  if (fromEmbedded.size > 0) return fromEmbedded;
  return diskDir === null ? new Map() : assetsFromDisk(diskDir);
}

/** Resolved once at boot — every request reads this map. */
let cached: Map<string, Uint8Array> | null = null;

export async function loadAssets(): Promise<Map<string, Uint8Array>> {
  // Bun types the array as plain Blob; the packed name is documented and is the
  // only thing identifying each entry.
  cached ??= await resolveAssets(
    Bun.embeddedFiles as readonly EmbeddedFile[],
    diskBuildDir(import.meta.dir),
  );
  return cached;
}
