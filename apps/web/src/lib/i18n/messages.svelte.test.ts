import { expect, test } from "vitest";
import { m } from "../paraglide/messages.js";

// Every module fetch leaves a shared-memory handle in Chromium's renderer until a GC; a module per
// message made each test file fetch ~1000 and a long browser session ran out of handles (#729).
test("the messages load as a module per locale, not one per message", () => {
  expect(m.nav_settings()).not.toBe("");

  const modules = performance
    .getEntriesByType("resource")
    .filter(({ name }) => new URL(name).pathname.startsWith("/src/lib/paraglide/"));

  expect(modules.length).toBeGreaterThan(0);
  expect(modules.length).toBeLessThan(10);
});
