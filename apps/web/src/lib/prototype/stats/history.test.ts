import { describe, expect, test } from "bun:test";
import { buildHistory, TODAY_BASE } from "./history";
import { buckets, selLabel, spanSel, step, total as rangeTotal } from "./query";

const h = buildHistory();
const total = (f: string) => h.day[f]!.reduce((a, b) => a + b, 0);

describe("fake history", () => {
  test("energy balances in every hour", () => {
    for (let t = 0; t < h.nowT; t++) {
      if (!h.hour.hours![t]) continue;
      const made = h.hour.pv![t]! - h.hour.feedIn![t]!;
      const used = h.hour.load![t]! - h.hour.imp![t]! + h.hour.charge![t]! - h.hour.discharge![t]!;
      expect(Math.abs(made - used)).toBeLessThan(1e-9);
    }
  });

  test("money follows the tariff in force", () => {
    for (let d = 0; d <= h.today; d += 37) {
      const p = h.tariff.findLast((v) => v.from <= d)!;
      expect(h.day.cost![d]!).toBeCloseTo((h.day.imp![d]! * p.imp) / 100, 9);
      expect(h.day.saved![d]!).toBeCloseTo(((h.day.load![d]! - h.day.imp![d]!) * p.imp + h.day.feedIn![d]! * p.feedIn) / 100, 9);
    }
  });

  test("strings sum to the plant", () => {
    const strings = h.strings.reduce((a, _, i) => a + total(`s${i}`), 0);
    expect(strings).toBeCloseTo(total("pv"), 6);
  });

  test("today matches the dashboard", () => {
    expect(h.day.pv![h.today]!).toBeCloseTo(TODAY_BASE.production, 6);
    expect(h.day.load![h.today]!).toBeCloseTo(TODAY_BASE.consumption, 6);
    expect(h.day.feedIn![h.today]!).toBeCloseTo(TODAY_BASE.feedIn, 6);
    expect(h.day.imp![h.today]!).toBeCloseTo(TODAY_BASE.purchase, 6);
  });

  test("a gap holds no readings and the battery fades", () => {
    const g = h.gaps[1]!;
    expect(h.hour.hours![g.t0]).toBe(0);
    expect(h.hour.pv![g.t0]).toBe(0);
    expect(h.capacity.at(-1)!.kwh).toBeLessThan(h.capacity[0]!.kwh);
  });

  test("a custom range starts and ends at an hour", () => {
    const d = (h.today - 6) * 24;
    const sel = spanSel(h, d + 8, d + 24 + 14);
    let pv = 0;
    for (let t = d + 8; t < d + 38; t++) pv += h.hour.pv![t]!;
    expect(rangeTotal(h, sel).pv!).toBeCloseTo(pv, 9);
    expect(buckets(h, sel)).toHaveLength(30);
    expect(selLabel(h, sel)).toContain("8 Uhr");
    expect(step(h, sel, -1)).toEqual(spanSel(h, d - 22, d + 8));
    expect(spanSel(h, d, d + 48)).toEqual({ kind: "custom", from: h.today - 6, to: h.today - 4 });
  });
});
