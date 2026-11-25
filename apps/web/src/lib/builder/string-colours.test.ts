/// <reference types="bun" />
import { STRINGS, UNASSIGNED, stringColour, stringCss } from "@sunreye/builder/values";
import { expect, test } from "bun:test";

test("a string takes its colour by position, again after the last, and none is grey", () => {
  expect(stringColour(0)).toBe(STRINGS[0]);
  expect(stringColour(STRINGS.length)).toBe(STRINGS[0]);
  expect(stringColour(null)).toBe(UNASSIGNED);
  expect(STRINGS).not.toContain(UNASSIGNED);
});

test("its CSS is the same colour as six hex digits", () => {
  expect([stringCss(0), stringCss(null)]).toEqual(["#1f5fbf", "#6b6f76"]);
});
