/// <reference types="bun" />
import { expect, test } from "bun:test";
import { touchFiles } from "./touch-tests.ts";

const found = touchFiles(import.meta.dirname);

test("a file that emulates touch is found, with whether it draws the scene", () => {
  expect(found).toContainEqual({ file: "src/lib/components/overlay.svelte.test.ts", scene: false });
  expect(found).toContainEqual({ file: "src/lib/scene/quality.svelte.test.ts", scene: true });
});

test("a file that only hovers is not", () => {
  expect(found.map(({ file }) => file)).not.toContain(
    "src/lib/components/row-tints.svelte.test.ts",
  );
});
