import { describe, expect, test } from "bun:test";
import { defaultDisplay, displayConfigSchema } from "./display";

describe("displayConfigSchema", () => {
  test("defaults to locale-following (auto clock, auto zone)", () => {
    expect(defaultDisplay).toEqual({ hourCycle: "auto", timeZone: "auto" });
  });

  test("accepts an explicit zone and clock, rejects an unknown zone", () => {
    expect(displayConfigSchema.parse({ hourCycle: "24h", timeZone: "Europe/Berlin" })).toEqual({
      hourCycle: "24h",
      timeZone: "Europe/Berlin",
    });
    expect(() => displayConfigSchema.parse({ timeZone: "Not/AZone" })).toThrow();
  });
});
