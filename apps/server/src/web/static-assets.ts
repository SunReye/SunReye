/**
 * Path resolution for the embedded SvelteKit build — the rules the addon's
 * nginx used to own (`sunreye/rootfs/etc/nginx/sunreye-locations.conf`), moved
 * into the binary now that the SPA ships inside it.
 *
 * Kept free of Bun/Elysia so the rules are testable on their own: the caller
 * owns the manifest and the actual file read.
 */

/** Hashed build artifacts never change content under the same name. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Everything else must revalidate. The fallback page names the hashed bundles,
 * so a browser holding a heuristically-cached copy would keep running the
 * previous build against an upgraded server.
 */
const PAGE_CACHE_CONTROL = "no-cache";

/** URL prefix under which the build emits content-hashed, forever-cacheable files. */
const IMMUTABLE_PREFIX = "/_app/immutable/";

/** The SPA fallback: every client route serves this page, hash router does the rest. */
const FALLBACK = "/index.html";

export interface ResolvedAsset {
  /** Manifest key to read the bytes from. */
  key: string;
  cacheControl: string;
}

/** Whether a decoded path stays inside the build root. */
function isContained(pathname: string): boolean {
  return pathname.startsWith("/") && !pathname.split("/").includes("..");
}

/** The request path with percent-escapes resolved, or null if it is malformed. */
function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * Which embedded file answers `pathname`, and how long it may be cached.
 * `null` means decline: nothing embedded, a traversal attempt, or a miss under
 * the immutable prefix (a stale manifest must 404, never answer a script
 * request with the HTML fallback).
 */
export function resolveAsset(
  manifest: ReadonlySet<string>,
  pathname: string,
): ResolvedAsset | null {
  if (!manifest.has(FALLBACK)) return null;

  const decoded = decodePath(pathname);
  if (decoded === null || !isContained(decoded)) return null;

  const key = decoded === "/" ? FALLBACK : decoded;
  if (manifest.has(key)) {
    const immutable = key.startsWith(IMMUTABLE_PREFIX);
    return { key, cacheControl: immutable ? IMMUTABLE_CACHE_CONTROL : PAGE_CACHE_CONTROL };
  }

  if (key.startsWith(IMMUTABLE_PREFIX)) return null;
  return { key: FALLBACK, cacheControl: PAGE_CACHE_CONTROL };
}

/**
 * Response content type per extension. The bytes come out of the build raw, so
 * nothing else can infer this — and a wrong type on the bundle or the page
 * stops the app from booting in the browser.
 */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  map: "application/json",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return CONTENT_TYPES[path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}
