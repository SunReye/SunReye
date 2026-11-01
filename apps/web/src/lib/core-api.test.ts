import { expect, test } from "bun:test";
import { renderCoreApiTypes, TYPES_FILE } from "../../scripts/gen-core-api";

test("core-api.gen.ts is generated from the committed OpenAPI document", async () => {
  const committed = await Bun.file(TYPES_FILE).text();
  // Stale types name the fix: the core's routes moved and the web client did not.
  expect(committed, "run `bun run --cwd apps/web gen:core-api`").toBe(await renderCoreApiTypes());
});
