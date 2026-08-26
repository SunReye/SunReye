/**
 * The metric value formatter.
 *
 * It shipped untested and only became visible to the coverage ratchet when the
 * animated-number extraction started importing it — but it is the module that
 * decides what every readout, tooltip and stat row actually says, including the
 * em dash that stands in for "no reading". Absent, non-finite and unlabelled
 * enum values are the cases that reach a screen during a comms fault, so they
 * are the ones pinned here.
 */

import type { ManifestMetric } from "@SunReye/inverter-core";
import { describe, expect, test } from "bun:test";
import { configuredDecimals, formatValue, fractionDigits } from "./format";

const metric = (over: Partial<ManifestMetric> = {}): ManifestMetric => ({
  key: "pv1_power",
  topic: "pv1/power",
  label: "PV1 Power",
  unit: "W",
  group: "pv",
  kind: "measurement",
  storage: "series",
  writable: false,
  ...over,
});

describe("configuredDecimals", () => {
  test("whole numbers for power and percent — fractional watts are noise", () => {
    expect(configuredDecimals("W")).toBe(0);
    expect(configuredDecimals("%")).toBe(0);
  });

  test("undefined for an unlisted, absent or empty unit", () => {
    for (const unit of ["kWh", "V", "", null, undefined]) {
      expect(configuredDecimals(unit)).toBeUndefined();
    }
  });
});

describe("fractionDigits", () => {
  test("a configured unit pins min and max to the same fixed count", () => {
    expect(fractionDigits("W")).toEqual({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
    expect(fractionDigits("%")).toEqual({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
  });

  test("an unlisted unit gets the 1..2 default, so `2` reads `2.0`", () => {
    for (const unit of ["kWh", "V", "", null, undefined]) {
      expect(fractionDigits(unit)).toEqual({
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      });
    }
    expect((2).toLocaleString("en-US", fractionDigits("kWh"))).toBe("2.0");
    expect((1.234).toLocaleString("en-US", fractionDigits("kWh"))).toBe("1.23");
  });
});

describe("formatValue", () => {
  test("an absent reading is an em dash, never a zero", () => {
    // A missing metric must not be able to read as 0 W — that is a fault state
    // rendered as a plausible measurement.
    expect(formatValue(metric(), undefined)).toBe("—");
  });

  test("a non-finite reading is an em dash too", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatValue(metric(), v)).toBe("—");
    }
  });

  test("a measurement formats at its unit's precision, zero and negative included", () => {
    const power = metric();
    expect(formatValue(power, 0)).toBe("0");
    expect(formatValue(power, 1234.6)).toBe(
      (1234.6).toLocaleString(undefined, fractionDigits("W")),
    );
    expect(formatValue(power, -750.4)).toBe(
      (-750.4).toLocaleString(undefined, fractionDigits("W")),
    );
    const energy = metric({ unit: "kWh" });
    expect(formatValue(energy, 2)).toBe((2).toLocaleString(undefined, fractionDigits("kWh")));
  });

  test("a status metric resolves through its enum labels", () => {
    const status = metric({
      kind: "status",
      unit: null,
      enumLabels: { 0: "Standby", 2: "Normal" },
    });
    expect(formatValue(status, 0)).toBe("Standby");
    expect(formatValue(status, 2)).toBe("Normal");
  });

  test("an unmapped status code falls back to the raw code, not to a label of another state", () => {
    const status = metric({ kind: "status", unit: null, enumLabels: { 0: "Standby" } });
    expect(formatValue(status, 7)).toBe("7");
    // …and an absent code is still the em dash, not the string "undefined".
    expect(formatValue(status, undefined)).toBe("—");
  });

  test("a status metric with no enumLabels formats as a plain number", () => {
    const status = metric({ kind: "status", unit: null });
    expect(formatValue(status, 3)).toBe((3).toLocaleString(undefined, fractionDigits(null)));
  });

  test("a non-status metric ignores enumLabels that got attached to it", () => {
    const odd = metric({ unit: null, enumLabels: { 3: "Normal" } });
    expect(formatValue(odd, 3)).toBe((3).toLocaleString(undefined, fractionDigits(null)));
  });
});
