/**
 * Pack the static SvelteKit build into the single file the server binary embeds
 * (`bun build --compile` only embeds files it sees imported, and every asset
 * name here is content-hashed). Runs as part of `bun run build:static`.
 *
 * See apps/server/src/web/asset-pack.ts for the container format.
 */
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { bakedPublicEnv } from "../../../scripts/static-build-env";
import { packAssets } from "../../server/src/web/asset-pack";
import { isCompressible, variantKey } from "../../server/src/web/encoding";

const buildDir = new URL("../build/", import.meta.url);
const out = new URL("../build.pack", import.meta.url);

const assets = new Map<string, Uint8Array>();
for await (const relative of new Bun.Glob("**/*").scan({ cwd: Bun.fileURLToPath(buildDir) })) {
  const bytes = await Bun.file(new URL(relative, buildDir)).bytes();
  assets.set(`/${relative}`, bytes);
}

if (!assets.has("/index.html")) {
  throw new Error("No index.html in apps/web/build — run the static build first");
}

// adapter-static freezes PUBLIC_* into _app/env.js at build time. Baking a
// PUBLIC_SERVER_URL would send every API call and the live socket to whatever
// host the build machine had configured — see scripts/static-build-env.ts.
const envModule = assets.get("/_app/env.js");
const baked = envModule ? bakedPublicEnv(new TextDecoder().decode(envModule)) : [];
if (baked.length > 0) {
  throw new Error(
    `Refusing to pack: static build baked public env (${baked.join(", ")}). ` +
      "Unset it (usually apps/web/.env) and rebuild — the packed dashboard is " +
      "served same-origin and derives its API base from the document URL.",
  );
}

// Precompressed variants, built once here so no request ever spends CPU on
// bytes that cannot change. Both are at maximum effort — this runs on a build
// machine, and the output is what every user downloads for the life of the
// release. A variant is kept only when it actually beats the raw bytes.
const withVariants = new Map(assets);
let saved = 0;
for (const [path, raw] of assets) {
  if (!isCompressible(path)) continue;
  const variants = {
    br: brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    gzip: Bun.gzipSync(raw, { level: 9 }),
  };
  for (const [encoding, bytes] of Object.entries(variants)) {
    if (bytes.length >= raw.length) continue;
    withVariants.set(variantKey(encoding, path), new Uint8Array(bytes));
    if (encoding === "br") saved += raw.length - bytes.length;
  }
}

const pack = packAssets(withVariants);
await Bun.write(out, pack);
console.log(
  `Packed ${assets.size} assets + ${withVariants.size - assets.size} precompressed variants ` +
    `into build.pack (${(pack.length / 1e6).toFixed(2)} MB); brotli saves ` +
    `${(saved / 1e6).toFixed(2)} MB per cold load`,
);
