// Each test starts with the pointer off the page (page.setup.ts): one left at rest over it hovers
// what the next test renders there, a frame later, and an interactive card rises 3px (#888).
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";

test("a test leaves the pointer over the page", async () => {
  await userEvent.hover(document.body);

  expect(document.documentElement.matches(":hover")).toBe(true);
});

test("the next test starts with it off the page", () => {
  expect(document.documentElement.matches(":hover")).toBe(false);
});
