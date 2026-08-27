/**
 * Container for the SvelteKit build embedded in the compiled binary.
 *
 * `bun build --compile` can only embed files it sees imported, and the build's
 * asset names are content-hashed — so instead of generating an import per file
 * (a churning generated module, and a manifest that can go stale against the
 * bytes) the whole build is packed into ONE file that the binary imports with
 * `with { type: "file" }`. Index and bytes ship together and cannot disagree.
 *
 * Layout: magic `SRP1` | uint32LE index length | index JSON | concatenated bytes.
 */

const MAGIC = "SRP1";
const MAGIC_LENGTH = 4;
const HEADER_LENGTH = MAGIC_LENGTH + 4;

/** `[path, offset into the payload, byte length]` per file, sorted by path. */
type PackIndex = [string, number, number][];

/** Every asset in one buffer, ordered by path so the same build packs identically. */
export function packAssets(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const index: PackIndex = [];
  let offset = 0;
  for (const [path, bytes] of sorted) {
    index.push([path, offset, bytes.length]);
    offset += bytes.length;
  }

  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const pack = new Uint8Array(HEADER_LENGTH + indexBytes.length + offset);
  pack.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(pack.buffer).setUint32(MAGIC_LENGTH, indexBytes.length, true);
  pack.set(indexBytes, HEADER_LENGTH);

  let at = HEADER_LENGTH + indexBytes.length;
  for (const [, bytes] of sorted) {
    pack.set(bytes, at);
    at += bytes.length;
  }
  return pack;
}

/** Decode a pack into path → bytes. A zero-byte pack means nothing was embedded. */
export function unpackAssets(pack: Uint8Array): Map<string, Uint8Array> {
  const assets = new Map<string, Uint8Array>();
  if (pack.length === 0) return assets;
  if (pack.length < HEADER_LENGTH) throw new Error("Asset pack is truncated");

  const decoder = new TextDecoder();
  if (decoder.decode(pack.subarray(0, MAGIC_LENGTH)) !== MAGIC) {
    throw new Error("Asset pack has an unrecognized header");
  }

  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const indexLength = view.getUint32(MAGIC_LENGTH, true);
  const payloadStart = HEADER_LENGTH + indexLength;
  if (payloadStart > pack.length) throw new Error("Asset pack index is truncated");

  const index = JSON.parse(decoder.decode(pack.subarray(HEADER_LENGTH, payloadStart))) as PackIndex;
  for (const [path, offset, length] of index) {
    const end = payloadStart + offset + length;
    if (end > pack.length) throw new Error(`Asset pack is truncated at ${path}`);
    assets.set(path, pack.subarray(payloadStart + offset, end));
  }
  return assets;
}

/**
 * Response content type per extension. The bytes come out of the pack raw, so
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
