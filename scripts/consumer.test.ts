import { expect, test } from "bun:test";
import { strays } from "./consumer.ts";

const INSTALL = "/x/consumer/node_modules";

/** Every package at version 1, but the one nested under vaul-svelte. */
const version = (root: string) => (root.includes("vaul-svelte/node_modules") ? "0.23.4" : "1");

test("one copy of each package, from the consumer's install, has no strays", () => {
  expect(
    strays(
      [
        `${INSTALL}/svelte/src/internal/client/index.js`,
        `${INSTALL}/svelte/src/index-client.js`,
        `${INSTALL}/three/build/three.module.js`,
        `${INSTALL}/@sunreye/builder/src/index.ts`,
        "/x/consumer/src/routes/+page.svelte",
      ],
      INSTALL,
      version,
    ),
  ).toEqual([]);
});

test("a package read from beside the consumer's install is a stray", () => {
  expect(
    strays(
      [
        `${INSTALL}/three/build/three.module.js`,
        "/x/home/node_modules/.bun/three@0.187.0/node_modules/three/build/three.module.js",
      ],
      INSTALL,
      version,
    ),
  ).toEqual([
    "three: /x/home/node_modules/.bun/three@0.187.0/node_modules/three",
    "three: two copies of 1",
  ]);
});

test("a package nested in another's install is a second copy", () => {
  expect(
    strays(
      [
        `${INSTALL}/@sunreye/ui/src/button/index.ts`,
        `${INSTALL}/@sunreye/builder/node_modules/@sunreye/ui/src/button/index.ts`,
      ],
      INSTALL,
      version,
    ),
  ).toEqual(["@sunreye/ui: two copies of 1"]);
});

test("another version nested where a package needs it is no second copy", () => {
  expect(
    strays(
      [`${INSTALL}/runed/dist/index.js`, `${INSTALL}/vaul-svelte/node_modules/runed/dist/index.js`],
      INSTALL,
      version,
    ),
  ).toEqual([]);
});
