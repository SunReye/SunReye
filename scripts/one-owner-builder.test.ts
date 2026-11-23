import { expect, test } from "bun:test";
import { copies } from "./one-owner.ts";

const HAPTIC = `import { haptics } from "@sunreye/ui/haptics";`;

test("the builder package is held to it too, its owners named from its sources as lib/'s", () => {
  expect(copies("packages/builder/src/builder/Outcome.svelte", HAPTIC)).toEqual([
    { rule: "haptics outside a shared component", line: 1 },
  ]);
  expect(copies("packages/builder/src/builder/picking.svelte.ts", HAPTIC)).toEqual([]);
});
