import { expect, test } from "vitest";
import { layout } from "./input.svelte.ts";

test("a mouse gets the hover rail at any width", () => {
  expect(layout({ fine: true, wide: false })).toBe("rail");
  expect(layout({ fine: true, wide: true })).toBe("rail");
});

test("touch at 768 px and wider gets the rail opened from its logo", () => {
  expect(layout({ fine: false, wide: true })).toBe("rail-open");
});

test("touch narrower than 768 px gets the bottom bar", () => {
  expect(layout({ fine: false, wide: false })).toBe("bar");
});
