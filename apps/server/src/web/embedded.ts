/**
 * The build embedded in this binary. The import is what makes
 * `bun build --compile` carry the pack inside the executable; under `bun run`
 * it resolves to the file on disk, so dev and the compiled binary take the
 * same path.
 */
import packPath from "../../../web/build.pack" with { type: "file" };
import { unpackAssets } from "./asset-pack";

/** Decoded once at boot — the pack is a few MB and every request reads it. */
let cached: Map<string, Uint8Array> | null = null;

export async function embeddedAssets(): Promise<Map<string, Uint8Array>> {
  cached ??= unpackAssets(await Bun.file(packPath).bytes());
  return cached;
}
