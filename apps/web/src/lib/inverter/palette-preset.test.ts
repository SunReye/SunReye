/**
 * Which palette the document ends up wearing.
 *
 * Both inputs come from storage — one from the server, one from
 * `localStorage`, which anything running on the device can write — so every
 * case here is about a value that is not what it should be.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PRESET,
  PALETTE_PRESETS,
  isPalettePreset,
  paletteAttribute,
  resolvePreset,
} from "./palette-preset";

describe("isPalettePreset", () => {
  test("accepts every preset offered", () => {
    for (const preset of PALETTE_PRESETS) expect(isPalettePreset(preset)).toBe(true);
  });

  test("rejects an id that is not offered, and non-strings", () => {
    expect(isPalettePreset("solarized")).toBe(false);
    expect(isPalettePreset("")).toBe(false);
    expect(isPalettePreset(null)).toBe(false);
    expect(isPalettePreset(3)).toBe(false);
    expect(isPalettePreset({ toString: () => "vivid" })).toBe(false);
  });
});

describe("resolvePreset", () => {
  test("uses the instance setting when this browser has no opinion", () => {
    expect(resolvePreset("vivid", null)).toBe("vivid");
    expect(resolvePreset("vivid", undefined)).toBe("vivid");
  });

  test("lets this browser override the instance", () => {
    // The whole point of the override: a reader who cannot separate the
    // instance palette can help themselves without being an admin, and without
    // changing what the wall display shows.
    expect(resolvePreset("categorical", "colorblind")).toBe("colorblind");
  });

  test("falls back when the instance value is unrecognised", () => {
    // A preset retired between releases; the stored row still names it.
    expect(resolvePreset("retired", null)).toBe(DEFAULT_PRESET);
  });

  test("ignores an unrecognised override instead of letting it win", () => {
    // localStorage is writable by anything on the device. An unknown value
    // there must not knock the instance setting out.
    expect(resolvePreset("vivid", "garbage")).toBe("vivid");
    expect(resolvePreset("vivid", "<script>")).toBe("vivid");
  });

  test("falls back when both are unusable", () => {
    expect(resolvePreset(null, null)).toBe(DEFAULT_PRESET);
    expect(resolvePreset(undefined, {})).toBe(DEFAULT_PRESET);
  });
});

describe("paletteAttribute", () => {
  test("stamps nothing for the shipped palette", () => {
    // `categorical` IS `:root`. Stamping it would make an instance that never
    // chose depend on a preset block existing, and would put a selector in
    // front of every token for no reason.
    expect(paletteAttribute("categorical")).toBe(null);
  });

  test("stamps the id for every other preset", () => {
    for (const preset of PALETTE_PRESETS) {
      if (preset === DEFAULT_PRESET) continue;
      expect(paletteAttribute(preset)).toBe(preset);
    }
  });
});
