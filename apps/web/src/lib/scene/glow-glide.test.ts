/// <reference types="bun" />
import { expect, test } from "bun:test";
import { GlowGlide } from "@sunreye/builder/scene/glow-glide.ts";

test("the first shares show at once", () => {
  const glide = new GlowGlide();

  glide.to([0.5, null], 0, 400);

  expect(glide.at(0)).toEqual([0.5, null]);
  expect(glide.done(0)).toBe(true);
});

test("a tick eases each module toward its new share and lands on it", () => {
  const glide = new GlowGlide();

  glide.to([0.2, 0.8], 0, 0);
  glide.to([0.6, 0.4], 1000, 400);

  const [rising = 0, falling = 0] = glide.at(1200);

  expect(rising).toBeGreaterThan(0.2);
  expect(rising).toBeLessThan(0.6);
  expect(falling).toBeLessThan(0.8);
  expect(falling).toBeGreaterThan(0.4);
  expect(glide.done(1200)).toBe(false);
  expect(glide.at(1400)).toEqual([0.6, 0.4]);
  expect(glide.done(1400)).toBe(true);
});

test("a tick mid-glide eases on from where the glow is, not from the last target", () => {
  const glide = new GlowGlide();

  glide.to([0], 0, 0);
  glide.to([1], 0, 1000);

  const shown = glide.at(500)[0] ?? 0;

  glide.to([1], 500, 1000);

  expect(glide.at(500)[0]).toBe(shown);
});

test("no duration steps straight to the new shares", () => {
  const glide = new GlowGlide();

  glide.to([0.2], 0, 0);
  glide.to([0.9], 10, 0);

  expect(glide.at(10)).toEqual([0.9]);
  expect(glide.done(10)).toBe(true);
});
