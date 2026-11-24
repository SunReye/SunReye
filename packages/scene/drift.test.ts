// The types follow the crates: the core's OpenAPI document is generated from them (ADR 9), and
// these from it.

import { expect, test } from "bun:test";
import { generate, sceneSchema } from "./generate.ts";

test("the committed types are what the core's OpenAPI document generates", async () => {
  const committed = await Bun.file(new URL("schema.d.ts", import.meta.url)).text();

  expect(committed).toBe(await generate());
});

test("the committed JSON Schema is what the core's OpenAPI document generates", async () => {
  const committed = await Bun.file(new URL("scene-schema.js", import.meta.url)).text();

  expect(committed).toBe(await sceneSchema());
});
