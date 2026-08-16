/**
 * Direction and judgement colours: flow, grid cost, battery health.
 *
 * These were Tailwind literals and three `rgb()` triples copied out of
 * Tailwind's palette — which put the most red/green dependent thing in the app
 * outside the theme entirely. A reader who cannot separate red from green could
 * restyle everything else and still be told "importing" and "exporting" in two
 * colours they see as one.
 */

import { describe, expect, test } from "bun:test";
import { flowClass, gridClass, socColor } from "./sign-colors";

describe("flowClass", () => {
  test("separates arriving from leaving", () => {
    expect(flowClass("in")).toBe("text-sign-good");
    expect(flowClass("out")).toBe("text-sign-warn");
    expect(flowClass("in")).not.toBe(flowClass("out"));
  });

  test("leaves an idle rail on the static border colour", () => {
    // Idle is not a third judgement; it is the absence of one.
    expect(flowClass("idle")).toBe("text-border");
  });

  test("spends only tokens", () => {
    // The point of the change: a literal here is a colour the palette cannot
    // reach.
    for (const flow of ["in", "out", "idle"] as const) {
      expect(flowClass(flow)).not.toMatch(/emerald|amber|red|green|-\d00$/);
    }
  });
});

describe("gridClass", () => {
  test("reads export as good and import as bad — cost, not direction", () => {
    // The grid meter is the one node where the sign means money rather than
    // which way the electrons went.
    expect(gridClass(-2000)).toBe("text-sign-good");
    expect(gridClass(2000)).toBe("text-sign-bad");
  });

  test("holds a deadband around zero", () => {
    // A meter hovering at zero would otherwise flicker between two colours on
    // every tick.
    expect(gridClass(0)).toBe("text-border");
    expect(gridClass(0.4)).toBe("text-border");
    expect(gridClass(-0.4)).toBe("text-border");
  });

  test("treats a missing reading as idle rather than as import", () => {
    // `undefined` arrives before the first frame and whenever the register is
    // absent; painting it red would announce a cost that was never measured.
    expect(gridClass(undefined)).toBe("text-border");
  });

  test("switches colour just outside the deadband", () => {
    expect(gridClass(0.6)).toBe("text-sign-bad");
    expect(gridClass(-0.6)).toBe("text-sign-good");
  });
});

describe("socColor", () => {
  test("is the bad token at empty and the good token when healthy", () => {
    expect(socColor(0)).toBe("var(--sign-bad)");
    expect(socColor(60)).toBe("var(--sign-good)");
    expect(socColor(100)).toBe("var(--sign-good)");
  });

  test("passes through the warn token at the middle stop", () => {
    expect(socColor(30)).toBe("var(--sign-warn)");
  });

  test("fades between stops rather than stepping between three bands", () => {
    // Halfway from empty to the middle stop.
    expect(socColor(15)).toBe("color-mix(in oklab, var(--sign-warn) 50%, var(--sign-bad))");
    // A quarter of the way from the middle stop to healthy.
    expect(socColor(37.5)).toBe("color-mix(in oklab, var(--sign-good) 25%, var(--sign-warn))");
  });

  test("mixes in oklab, because red to green through sRGB goes via mud", () => {
    expect(socColor(15)).toContain("in oklab");
  });

  test("clamps rather than extrapolating past the ends", () => {
    // SOC arrives from an inverter register; a bad frame must not produce a
    // colour outside the ramp.
    expect(socColor(150)).toBe("var(--sign-good)");
    expect(socColor(-20)).toBe("var(--sign-bad)");
  });

  test("never bakes a colour value into the result", () => {
    // The old version interpolated `rgb()` triples copied from Tailwind, so the
    // ramp ignored the theme completely — including in dark mode.
    for (const soc of [0, 15, 30, 45, 60, 80, 100]) {
      expect(socColor(soc)).not.toMatch(/rgb\(|#[0-9a-f]{3,6}|oklch\(/);
    }
  });

  test("returns a stable string for changes nobody can see", () => {
    // The ring redraws on every SOC tick; a new string per hundredth of a
    // percent would churn the style attribute for nothing.
    expect(socColor(15)).toBe(socColor(15.001));
  });
});
