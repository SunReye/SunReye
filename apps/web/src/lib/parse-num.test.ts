import { describe, expect, it } from "bun:test";
import { parseNum } from "./parse-num";

describe("parseNum", () => {
  it("reads a plain, negative and decimal number", () => {
    expect(parseNum("42")).toBe(42);
    expect(parseNum("-7.5")).toBe(-7.5);
    expect(parseNum("0.25")).toBe(0.25);
  });

  it("keeps zero as zero, not as unset", () => {
    expect(parseNum("0")).toBe(0);
    expect(parseNum(" 0 ")).toBe(0);
  });

  it("treats blank and whitespace as unset", () => {
    expect(parseNum("")).toBeNull();
    expect(parseNum("   ")).toBeNull();
  });

  it("refuses a half-typed or non-finite entry", () => {
    expect(parseNum("-")).toBeNull();
    expect(parseNum("abc")).toBeNull();
    expect(parseNum("Infinity")).toBeNull();
    expect(parseNum("1e999")).toBeNull();
  });
});
