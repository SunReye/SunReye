import { describe, expect, test } from "bun:test";

import { splitRetired } from "./device-lifecycle";
import type { DeviceView } from "./device-types";

const device = (id: number, retiredAt: string | null = null) => ({ id, retiredAt }) as DeviceView;

describe("the retired devices fold away under their own disclosure", () => {
  test("splits in service from retired, keeping the order of each", () => {
    const rows = [device(1), device(2, "2026-01-01"), device(3), device(4, "2026-02-01")];
    const { active, retired } = splitRetired(rows);
    expect(active.map((d) => d.id)).toEqual([1, 3]);
    expect(retired.map((d) => d.id)).toEqual([2, 4]);
  });

  test("an empty list is two empty halves", () => {
    expect(splitRetired([])).toEqual({ active: [], retired: [] });
  });
});
