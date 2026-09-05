import { describe, expect, test } from "bun:test";
import { capMatchesRegister, registerCapKw } from "./export-cap-register";

const reading = (value: number | undefined, stale = false) => ({ value, stale });

describe("registerCapKw", () => {
  test("is the register's watts as the field's kW text", () => {
    expect(registerCapKw(reading(8000))).toBe("8");
    expect(registerCapKw(reading(6600))).toBe("6.6");
  });

  test("a stale reading is still a number the operator can copy", () => {
    // The chip copies a value once; it does not animate it. Staleness is shown
    // beside it, not used to hide it.
    expect(registerCapKw(reading(8000, true))).toBe("8");
  });

  test("zero is a value, not an absence", () => {
    expect(registerCapKw(reading(0))).toBe("0");
  });

  test("nothing to copy when the profile maps no sell register", () => {
    expect(registerCapKw(reading(undefined))).toBeNull();
  });
});

describe("capMatchesRegister", () => {
  test("agrees when the field says what the register holds", () => {
    expect(capMatchesRegister("8", reading(8000))).toBe(true);
    expect(capMatchesRegister("6,6", reading(6600))).toBe(true);
  });

  test("disagrees when they differ by a whole watt or more", () => {
    expect(capMatchesRegister("8", reading(8500))).toBe(false);
    expect(capMatchesRegister("0", reading(100))).toBe(false);
  });

  test("tolerates the float noise of a kW round trip", () => {
    expect(capMatchesRegister("6.6", reading(6600.0000001))).toBe(true);
  });

  test("has no opinion when either side is missing or unparseable", () => {
    expect(capMatchesRegister("", reading(8000))).toBeNull();
    expect(capMatchesRegister("8", reading(undefined))).toBeNull();
    expect(capMatchesRegister("abc", reading(8000))).toBeNull();
  });
});
