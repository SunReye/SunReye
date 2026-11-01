/**
 * Types of the Rust core's REST surface, from the OpenAPI document the core commits
 * (`crates/sunreye/openapi_snapshot.json`). `bun run gen:core-api` rewrites `src/lib/core-api.gen.ts`;
 * `src/lib/core-api.test.ts` fails while the committed file is stale.
 */
import openapiTS, { astToString } from "openapi-typescript";

const DOCUMENT = new URL("../../../crates/sunreye/openapi_snapshot.json", import.meta.url);
export const TYPES_FILE = new URL("../src/lib/core-api.gen.ts", import.meta.url);

export async function renderCoreApiTypes(): Promise<string> {
  return astToString(await openapiTS(DOCUMENT));
}

if (import.meta.main) {
  await Bun.write(TYPES_FILE, await renderCoreApiTypes());
}
