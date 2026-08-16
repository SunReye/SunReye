import { describe, expect, test } from "bun:test";
import { defaultPlant, plantConfigSchema, resolveServerZone } from "./plant";

describe("plantConfigSchema", () => {
  test("defaults the plant zone to the auto sentinel", () => {
    expect(defaultPlant).toEqual({ timeZone: "auto" });
  });

  test("accepts a valid IANA zone and rejects an unknown one", () => {
    expect(plantConfigSchema.parse({ timeZone: "Europe/Berlin" })).toEqual({
      timeZone: "Europe/Berlin",
    });
    expect(() => plantConfigSchema.parse({ timeZone: "Not/AZone" })).toThrow();
  });
});

describe("resolveServerZone", () => {
  test("an explicit plant zone wins over the display zone and the host", () => {
    expect(resolveServerZone("Europe/Berlin", "America/New_York", "UTC")).toBe("Europe/Berlin");
    expect(resolveServerZone("Europe/Berlin", "auto", "UTC")).toBe("Europe/Berlin");
  });

  test("falls back to an explicit display zone when the plant zone is auto (legacy inheritance)", () => {
    // Instances that set Display → time zone to fix #46/#52 keep working with no
    // migration, until a plant zone is set explicitly.
    expect(resolveServerZone("auto", "Europe/Berlin", "UTC")).toBe("Europe/Berlin");
    expect(resolveServerZone(defaultPlant.timeZone, "Europe/Berlin", "UTC")).toBe("Europe/Berlin");
  });

  test("falls back to the host zone when both plant and display are auto", () => {
    expect(resolveServerZone("auto", "auto", "UTC")).toBe("UTC");
    expect(resolveServerZone("auto", "auto", "Europe/Berlin")).toBe("Europe/Berlin");
  });
});
