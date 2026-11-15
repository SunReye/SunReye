/// <reference types="bun" />
import { expect, test } from "bun:test";
import { daysIn, parts, written } from "./day.ts";

test("a written day reads back as its parts", () => {
  expect(parts("2026-11-01")).toEqual({ year: 2026, month: 11, day: 1 });
  expect(written({ year: 2026, month: 11, day: 1 })).toBe("2026-11-01");
  expect(written({ year: 2030, month: 6, day: 21 })).toBe("2030-06-21");
});

test("a month has its own days, February a leap day every fourth year", () => {
  expect(daysIn(2026, 11)).toBe(30);
  expect(daysIn(2026, 12)).toBe(31);
  expect(daysIn(2026, 2)).toBe(28);
  expect(daysIn(2028, 2)).toBe(29);
});

test("text that is no calendar day has no parts", () => {
  expect(parts("")).toBeUndefined();
  expect(parts("2026-02-30")).toBeUndefined();
  expect(parts("2026-13-01")).toBeUndefined();
  expect(parts("13/11/2026")).toBeUndefined();
});
