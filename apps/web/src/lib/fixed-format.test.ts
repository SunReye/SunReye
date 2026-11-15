import { expect, test } from "bun:test";
import { fixedFormat } from "./fixed-format.ts";

test("a fixed format writes exactly its digits, in the SPA's locale", () => {
  expect(fixedFormat(1).format(1234.56)).toBe("1.234,6");
  expect(fixedFormat(0).format(0.4)).toBe("0");
});

test("a rounded-away negative keeps its sign unless the format drops it", () => {
  expect(fixedFormat(0).format(-0.4)).toBe("-0");
  expect(fixedFormat(0, "negative").format(-0.4)).toBe("0");
});

test("one formatter serves every call with the same digits and sign", () => {
  expect(fixedFormat(2)).toBe(fixedFormat(2));
  expect(fixedFormat(2, "negative")).not.toBe(fixedFormat(2));
});
