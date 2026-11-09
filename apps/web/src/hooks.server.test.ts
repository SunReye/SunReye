/// <reference types="bun" />
import { expect, test } from "bun:test";
import { relativeAssets } from "./hooks.server.ts";

test("the page links its built assets relative to itself", () => {
  const page = relativeAssets(`<link href="/_app/a.js"><script>import("/_app/b.js")</script>`);

  expect(page).toBe(`<link href="./_app/a.js"><script>import("./_app/b.js")</script>`);
});
