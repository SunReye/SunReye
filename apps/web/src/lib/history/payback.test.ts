import { expect, test } from "bun:test";
import { paybackShare } from "./payback.ts";

test("payback is the savings' share of the investment, capped at whole", () => {
  expect(paybackShare({ investment: 12_000, savings: 3000, remaining: 9000 })).toBe(0.25);
  expect(paybackShare({ investment: 1000, savings: 3000, remaining: 0 })).toBe(1);
  expect(paybackShare({ investment: null, savings: 300, remaining: null })).toBeNull();
});
