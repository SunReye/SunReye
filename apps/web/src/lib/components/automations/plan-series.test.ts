import { describe, expect, test } from "bun:test";
import type { DecisionPoint, PeakShavingPlan, PlanSlot } from "$lib/automations";
import { measuredDaySeries, toPlanRows, toSocRows } from "./plan-series";

const T0 = Date.parse("2026-07-27T12:00:00Z");
const SLOT = 15 * 60_000;

const slot = (over: Partial<PlanSlot> = {}): PlanSlot => ({
  t: T0,
  pvW: 8000,
  loadW: 500,
  thresholdW: 5500,
  targetA: 40,
  chargeW: 2000,
  dischargeW: 0,
  exportW: 5500,
  curtailedW: 0,
  socPct: 55,
  ...over,
});

const plan = (slots: PlanSlot[]): PeakShavingPlan => ({
  slots,
  chargeStartsAt: slots[0]?.t ?? null,
  fullAt: null,
  endSocPct: slots.at(-1)?.socPct ?? 0,
  storedKwh: 1,
  exportedKwh: 2,
  curtailedKwh: 0,
});

const historyPoint = (t: number, socPct: number): DecisionPoint => ({
  t,
  shadow: true,
  pvW: 0,
  loadW: null,
  evChargeW: null,
  localSinkW: 0,
  thresholdW: 0,
  targetA: 0,
  liveA: null,
  batteryV: 50,
  chargeW: null,
  exportW: null,
  socPct,
});

describe("toPlanRows", () => {
  test("splits the slot into bands that add back up to forecast PV", () => {
    const [row] = toPlanRows([slot({ pvW: 8000, loadW: 500, chargeW: 2000, exportW: 5500 })]);
    expect(row).toMatchObject({ loadKw: 0.5, chargeKw: 2, exportKw: 5.5, curtailedKw: 0, pvKw: 8 });
    const stacked = row!.loadKw + row!.chargeKw + row!.exportKw + row!.curtailedKw;
    expect(stacked).toBeCloseTo(row!.pvKw, 6);
  });

  test("curtailment closes the gap when neither battery nor grid can take it", () => {
    const [row] = toPlanRows([
      slot({ pvW: 12_000, loadW: 500, chargeW: 0, exportW: 8400, curtailedW: 3100 }),
    ]);
    const stacked = row!.loadKw + row!.chargeKw + row!.exportKw + row!.curtailedKw;
    expect(row!.curtailedKw).toBe(3.1);
    expect(stacked).toBeCloseTo(12, 6);
  });

  test("a load bigger than the forecast PV never overflows the stack", () => {
    const [row] = toPlanRows([
      slot({ pvW: 300, loadW: 2000, chargeW: 0, exportW: 0, curtailedW: 0 }),
    ]);
    expect(row).toMatchObject({ loadKw: 0.3, pvKw: 0.3 });
  });
});

describe("toSocRows", () => {
  const history = [historyPoint(T0 - 2 * SLOT, 40), historyPoint(T0 - SLOT, 45)];
  const slots = [
    slot({ t: T0, socPct: 55 }),
    slot({ t: T0 + SLOT, socPct: 70 }),
    slot({ t: T0 + 2 * SLOT, socPct: 82 }),
  ];

  test("measured and projected ride on separate series", () => {
    const rows = toSocRows(history, plan(slots));
    expect(rows.filter((r) => r.socPct !== null && r.planSocPct === null)).toHaveLength(2);
    expect(rows.filter((r) => r.planSocPct !== null && r.socPct === null)).toHaveLength(3);
  });

  test("the hand-over row carries both values so the lines meet", () => {
    const rows = toSocRows(history, plan(slots));
    const handOver = rows.find((r) => r.socPct !== null && r.planSocPct !== null);
    // Last measured SOC, at the first projected slot's start.
    expect(handOver).toMatchObject({ socPct: 45, planSocPct: 45 });
    expect(handOver?.t.getTime()).toBe(T0);
  });

  test("projected SOC is stamped at the slot end, not its start", () => {
    const rows = toSocRows(history, plan(slots));
    const projected = rows.filter((r) => r.planSocPct !== null && r.socPct === null);
    expect(projected.map((r) => r.t.getTime())).toEqual([T0 + SLOT, T0 + 2 * SLOT, T0 + 3 * SLOT]);
  });

  test("history alone when there is no plan", () => {
    expect(toSocRows(history, null).map((r) => r.socPct)).toEqual([40, 45]);
    expect(toSocRows(history, plan([]))).toHaveLength(2);
  });

  test("a plan with no history still starts from the projection", () => {
    const rows = toSocRows([], plan(slots));
    expect(rows[0]).toMatchObject({ socPct: 55, planSocPct: 55 });
  });
});

describe("measuredDaySeries", () => {
  const map = (entries: [number, number][]) => new Map(entries);

  test("flips battery/grid signs so the charging and exporting halves stack", () => {
    const { power } = measuredDaySeries({
      pv: map([[T0, 8000]]),
      batt: map([[T0, -2000]]),
      grid: map([[T0, -5500]]),
      soc: map([[T0, 55]]),
    });
    expect(power[0]).toMatchObject({ loadKw: 0.5, chargeKw: 2, exportKw: 5.5, socPct: 55 });
  });

  test("unmetered battery and grid leave the whole PV on the house", () => {
    const { power, soc } = measuredDaySeries({
      pv: map([[T0, 3000]]),
      batt: null,
      grid: null,
      soc: null,
    });
    expect(power[0]).toMatchObject({ loadKw: 3, chargeKw: 0, exportKw: 0, socPct: 0 });
    expect(soc).toEqual([]);
  });

  test("rows come out time-sorted and the SOC track mirrors its map", () => {
    const { power, soc } = measuredDaySeries({
      pv: map([
        [T0 + SLOT, 2000],
        [T0, 1000],
      ]),
      batt: null,
      grid: null,
      soc: map([
        [T0, 40],
        [T0 + SLOT, 45],
      ]),
    });
    expect(power.map((r) => r.t.getTime())).toEqual([T0, T0 + SLOT]);
    expect(soc).toEqual([
      { t: T0, socPct: 40 },
      { t: T0 + SLOT, socPct: 45 },
    ]);
  });

  test("long days are decimated but keep the newest sample", () => {
    const minute = 60_000;
    const entries: [number, number][] = Array.from({ length: 1441 }, (_, i) => [
      T0 + i * minute,
      1000,
    ]);
    const { power } = measuredDaySeries({ pv: map(entries), batt: null, grid: null, soc: null });
    expect(power.length).toBeLessThanOrEqual(721);
    expect(power.at(-1)?.t.getTime()).toBe(T0 + 1440 * minute);
  });
});
