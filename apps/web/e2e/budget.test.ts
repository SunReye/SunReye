import { describe, expect, test } from "bun:test";
import { verdict } from "./budget.ts";

const steady = Array.from({ length: 100 }, () => 16.7);

describe("a journey's frame budget (ADR 21)", () => {
  test("steady 60 Hz frames pass", () => {
    expect(verdict(steady).pass).toBe(true);
  });

  test("one frame over 50 ms fails, however few", () => {
    expect(verdict([...steady, 51]).pass).toBe(false);
  });

  test("a 95th percentile over 20 ms fails though no frame passes 50 ms", () => {
    const janky = [
      ...Array.from({ length: 90 }, () => 16.7),
      ...Array.from({ length: 10 }, () => 33),
    ];

    expect(verdict(janky)).toEqual({ pass: false, max: 33, p95: 33, frames: 100 });
  });

  test("5 % of frames at 33 ms sit beyond the 95th percentile and pass", () => {
    const fine = [
      ...Array.from({ length: 95 }, () => 16.7),
      ...Array.from({ length: 5 }, () => 33),
    ];

    expect(verdict(fine)).toEqual({ pass: true, max: 33, p95: 16.7, frames: 100 });
  });

  test("a journey that drew no frame fails", () => {
    expect(verdict([]).pass).toBe(false);
  });
});
