import { describe, expect, test } from "bun:test";

/**
 * The theme's surface/foreground pairs have to be *readable*, and one pair has
 * now failed twice.
 *
 * `--accent` is shadcn's SUBTLE surface — a hover, a highlighted menu row — and
 * `--accent-foreground` is the text on it. Both had been set to the primary
 * pair, which made every `bg-accent` surface solid brand blue and left the
 * foreground near-white in light mode. The select dropdown then read as white
 * text on a near-white row, because its highlighted item overrides the
 * background to `bg-foreground/10` and keeps the accent foreground. The same
 * collision produced the calendar's phantom-selected day earlier.
 *
 * So the invariant is asserted on the stylesheet rather than left to the eye.
 */
const css = await Bun.file(new URL("../../app.css", import.meta.url).pathname).text();

/**
 * The two theme blocks, sliced on their selectors rather than on a token.
 *
 * Slicing at the token would have read each block's tail only, and the tokens
 * being compared are declared ABOVE it — the comparison would then find the
 * `@theme inline` mappings instead and quietly compare a name with itself.
 */
function blocks(): { light: string; dark: string } {
  const lightStart = css.indexOf(":root {");
  const darkStart = css.indexOf(".dark {");
  expect(lightStart).toBeGreaterThan(-1);
  expect(darkStart).toBeGreaterThan(lightStart);
  return {
    light: css.slice(lightStart, darkStart),
    dark: css.slice(darkStart, css.indexOf("@theme inline")),
  };
}

/** An `oklch(L …)` token's lightness, 0..1. */
function lightness(source: string, token: string): number {
  const match = new RegExp(`--${token}:\\s*oklch\\(([\\d.]+)`).exec(source);
  if (!match?.[1]) throw new Error(`no oklch lightness for --${token}`);
  return Number(match[1]);
}

/** A token's whole declared value, for identity comparisons. */
function value(source: string, token: string): string {
  const match = new RegExp(`--${token}:\\s*([^;]+);`).exec(source);
  if (!match?.[1]) throw new Error(`no value for --${token}`);
  return match[1].trim();
}

const MODES = ["light", "dark"] as const;

describe("the accent pair", () => {
  test.each(MODES)("%s: is a surface of its own, not an alias of primary", (mode) => {
    // The defect exactly: accent set to the primary pair. Brand blue stays one
    // token away as `--primary` wherever it is actually wanted.
    const source = blocks()[mode];
    expect(value(source, "accent")).not.toBe(value(source, "primary"));
    expect(value(source, "accent-foreground")).not.toBe(value(source, "primary-foreground"));
  });

  test.each(MODES)("%s: its foreground is readable on it", (mode) => {
    // Lightness separation, not a full contrast model: the failure was white on
    // near-white, and any honest threshold catches that. 0.4 keeps normal text
    // pairs comfortably apart without demanding pure black on pure white.
    const source = blocks()[mode];
    const separation = Math.abs(
      lightness(source, "accent") - lightness(source, "accent-foreground"),
    );
    expect(separation).toBeGreaterThan(0.4);
  });

  test.each(MODES)("%s: stays a SUBTLE surface, close to the page behind it", (mode) => {
    // A hover tint that jumps far from the background is not a hover tint. This
    // is what stops the pair being "fixed" by making it a second brand colour.
    const source = blocks()[mode];
    const drift = Math.abs(lightness(source, "accent") - lightness(source, "muted"));
    expect(drift).toBeLessThan(0.1);
  });
});
