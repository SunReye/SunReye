/**
 * The accent pair, read off the cascade the app actually ships.
 *
 * `--accent` is shadcn's SUBTLE surface (a hovered menu row, a highlighted
 * select item) and `--accent-foreground` the text on it. Twice it was set to the
 * primary pair: every `bg-accent` surface went solid brand blue, a highlighted
 * select row read white on near-white, and the calendar grew a phantom-selected
 * day. Here the stylesheet is loaded for real (the component setup imports
 * `app.css`) and the colours are the computed ones, in both themes.
 */
import { afterEach, describe, expect, test } from "vitest";

/** OKLCH lightness of a computed colour; Chromium serialises oklch() as-is. */
function lightness(color: string): number {
  const match = /^oklch\(([\d.]+)/.exec(color);
  if (!match?.[1]) throw new Error(`not an oklch colour: ${color}`);
  return Number(match[1]);
}

function swatch(classes: string): CSSStyleDeclaration {
  const el = document.createElement("div");
  el.className = classes;
  el.textContent = "Swatch";
  document.body.append(el);
  return getComputedStyle(el);
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.replaceChildren();
});

describe.each(["light", "dark"] as const)("%s theme", (mode) => {
  const setMode = () => document.documentElement.classList.toggle("dark", mode === "dark");

  test("an accent surface is not the brand colour", () => {
    setMode();
    const accent = swatch("bg-accent text-accent-foreground");
    const primary = swatch("bg-primary text-primary-foreground");
    expect(accent.backgroundColor).not.toBe(primary.backgroundColor);
    expect(accent.color).not.toBe(primary.color);
  });

  test("text on an accent surface is readable", () => {
    setMode();
    const accent = swatch("bg-accent text-accent-foreground");
    const separation = Math.abs(lightness(accent.backgroundColor) - lightness(accent.color));
    expect(separation).toBeGreaterThan(0.4);
  });

  test("the accent surface stays close to the muted page tone — a tint, not a second brand", () => {
    setMode();
    const accent = swatch("bg-accent");
    const muted = swatch("bg-muted");
    const drift = Math.abs(lightness(accent.backgroundColor) - lightness(muted.backgroundColor));
    expect(drift).toBeLessThan(0.1);
  });
});
