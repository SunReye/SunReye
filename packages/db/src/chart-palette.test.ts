/**
 * The palette preference's stored shape.
 *
 * Every case here is about a value that arrives from the database rather than
 * from the form: this repo's settings accessor `safeParse`s and silently falls
 * back to the default with no log, so a schema that throws where it could
 * degrade turns "this one field is stale" into "every field reset, quietly".
 */

import { describe, expect, test } from "bun:test";
import {
  CHART_PALETTE_KEY,
  PALETTE_PRESETS,
  chartPaletteSchema,
  defaultChartPalette,
} from "./chart-palette";

describe("chartPaletteSchema", () => {
  test("an unset instance gets the shipped palette", () => {
    expect(chartPaletteSchema.parse({})).toEqual({ preset: "categorical" });
    expect(defaultChartPalette.preset).toBe("categorical");
  });

  test("round-trips every preset it offers", () => {
    for (const preset of PALETTE_PRESETS) {
      expect(chartPaletteSchema.parse({ preset })).toEqual({ preset });
    }
  });

  test("degrades a retired id instead of failing the parse", () => {
    // The list will change. A throw here reaches the settings accessor, which
    // swallows it and returns the default for the WHOLE object — so a schema
    // that cannot degrade loses sibling fields the day an id is renamed.
    expect(chartPaletteSchema.parse({ preset: "solarized" })).toEqual({ preset: "categorical" });
  });

  test("degrades a value of the wrong type, from a hand-edited blob", () => {
    expect(chartPaletteSchema.parse({ preset: 7 })).toEqual({ preset: "categorical" });
    expect(chartPaletteSchema.parse({ preset: null })).toEqual({ preset: "categorical" });
  });

  test("is a flat record — no discriminated union", () => {
    // House rule: a discriminated union in app_settings makes every unknown
    // variant an unrecoverable parse failure, which the accessor turns into a
    // silent reset.
    expect(chartPaletteSchema.parse({ preset: "vivid", stray: true })).toEqual({
      preset: "vivid",
    });
  });

  test("the storage key is stable", () => {
    // It is the primary key of a row that already exists on upgraded
    // instances; renaming it silently loses the user's choice.
    expect(CHART_PALETTE_KEY).toBe("chartPalette");
  });
});

describe("PALETTE_PRESETS", () => {
  test("names the shipped palette first", () => {
    // The default has to be the one the app is designed in, or an instance that
    // never chose renders in something nobody validated.
    expect(PALETTE_PRESETS[0]).toBe("categorical");
  });

  test("has no duplicates", () => {
    expect(new Set(PALETTE_PRESETS).size).toBe(PALETTE_PRESETS.length);
  });
});
