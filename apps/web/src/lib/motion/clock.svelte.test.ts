import { afterEach, expect, test, vi } from "vitest";
import { playFrame } from "./clock.harness.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a frame played while the test holds the frames itself, on the real clock, is the test's", () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);

  expect(() => {
    playFrame();
  }).not.toThrow();
});
