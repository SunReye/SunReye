import { describe, expect, test } from "bun:test";
import { DEVICE_CLASSES, isDeviceClass } from "./device-class";

describe("DEVICE_CLASSES", () => {
  test("names the five modelled classes in schema order", () => {
    expect([...DEVICE_CLASSES]).toEqual([
      "inverter",
      "controller",
      "meter",
      "charger",
      "optimizer",
    ]);
  });

  test("isDeviceClass admits exactly the catalogued spellings", () => {
    for (const c of DEVICE_CLASSES) expect(isDeviceClass(c)).toBe(true);
    expect(isDeviceClass("virtual")).toBe(false);
    expect(isDeviceClass("Inverter")).toBe(false);
    expect(isDeviceClass("")).toBe(false);
  });
});
