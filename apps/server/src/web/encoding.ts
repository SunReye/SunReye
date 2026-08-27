/**
 * Content negotiation for the embedded build.
 *
 * The addon's nginx gzipped everything on the way out; serving the pack raw
 * sent 2.4 MB of bundle where nginx sent ~650 kB. Compressing per request would
 * burn CPU on a Raspberry-Pi-class host for bytes that never change, so both
 * variants are built once at pack time and this module only picks between them.
 */

/**
 * Variants live in the same flat pack as the assets themselves. Every real URL
 * path starts with "/", so a NUL-prefixed key cannot collide with one.
 */
export function variantKey(encoding: string, path: string): string {
  return `\0${encoding}${path}`;
}

/** Encodings we pack, best first. */
export const PACKED_ENCODINGS = ["br", "gzip"] as const;

/**
 * Extensions worth compressing. woff2 is brotli internally and the image
 * formats carry their own codec — recompressing them costs build time and pack
 * space to save nothing.
 */
const COMPRESSIBLE = new Set(["html", "js", "css", "json", "map", "svg", "webmanifest", "txt"]);

export function isCompressible(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && COMPRESSIBLE.has(path.slice(dot + 1).toLowerCase());
}

/** One `Accept-Encoding` entry: the token and the quality the client gave it. */
function acceptedQualities(header: string): Map<string, number> {
  const qualities = new Map<string, number>();
  for (const part of header.split(",")) {
    const [token, ...params] = part.split(";").map((s) => s.trim());
    if (!token) continue;
    const q = params.map((p) => /^q=([\d.]+)$/i.exec(p)).find((m) => m !== null)?.[1];
    qualities.set(token.toLowerCase(), q === undefined ? 1 : Number.parseFloat(q));
  }
  return qualities;
}

/**
 * The encoding to answer with, or `null` for the raw bytes. `available` is what
 * the pack actually holds for this asset — a variant is only offered if it was
 * built, and only if the client did not refuse it with `q=0`.
 */
export function negotiateEncoding(
  acceptEncoding: string | null,
  available: ReadonlySet<string>,
): string | null {
  if (!acceptEncoding) return null;

  const qualities = acceptedQualities(acceptEncoding);
  const wildcard = qualities.get("*");

  let best: string | null = null;
  let bestQuality = 0;
  for (const encoding of PACKED_ENCODINGS) {
    if (!available.has(encoding)) continue;
    const quality = qualities.get(encoding) ?? wildcard;
    if (quality === undefined || quality <= 0) continue;
    // Ties keep the earlier (better-compressing) entry of PACKED_ENCODINGS.
    if (quality > bestQuality) {
      best = encoding;
      bestQuality = quality;
    }
  }
  return best;
}
