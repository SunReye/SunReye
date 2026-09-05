import { describe, expect, test } from "bun:test";
import type { PeakShavingPlan, PlanSlot } from "$lib/automations";
import { measuredDaySeries } from "$lib/history/day-rows";
import { joinDayRows, toPlanRows, toSocRows } from "./plan-series";

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
  // The measured half is the plant's OWN SOC series now — `{t, socPct}` off the
  // minute rollups, which is exactly what `measuredDaySeries` produces. It used
  // to be the engine's decision ring, which only carried the ticks the
  // automation decided and cleared on every restart.
  const history = [
    { t: T0 - 2 * SLOT, socPct: 40 },
    { t: T0 - SLOT, socPct: 45 },
  ];
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

  test("the measured half of a day joins straight onto the projection", () => {
    // The two halves of the SOC chart are produced by two different modules;
    // this is the seam between them, and it is a shape contract.
    const { soc } = measuredDaySeries({
      pv: new Map([[T0 - SLOT, 4000]]),
      batt: new Map(),
      grid: new Map(),
      soc: new Map([[T0 - SLOT, 45]]),
    });
    expect(toSocRows(soc, plan(slots)).at(0)).toMatchObject({ socPct: 45, planSocPct: null });
  });
});

describe("joinDayRows", () => {
  /** The measured day, as `$lib/history/day-rows` produces it. */
  const measured = measuredDaySeries({
    pv: new Map([
      [T0 - SLOT, 8000],
      [T0, 8000],
    ]),
    batt: new Map([
      [T0 - SLOT, -2000],
      [T0, -2000],
    ]),
    grid: new Map([
      [T0 - SLOT, -5500],
      [T0, -5500],
    ]),
    soc: new Map(),
  }).power;
  const projected = toPlanRows([
    slot({ t: T0 - SLOT }),
    slot({ t: T0 }),
    slot({ t: T0 + SLOT }),
    slot({ t: T0 + 2 * SLOT }),
  ]);

  test("the projection picks up strictly after the last measured sample", () => {
    // The plan's running slot started before "now", so its first rows overlap
    // what has already been measured; keeping them double-plots the same minutes.
    const rows = joinDayRows(measured, projected);
    expect(rows.map((r) => r.t.getTime())).toEqual([T0 - SLOT, T0, T0 + SLOT, T0 + 2 * SLOT]);
  });

  test("a plan row landing exactly on the seam is dropped, not duplicated", () => {
    const rows = joinDayRows(measured, toPlanRows([slot({ t: T0 })]));
    expect(rows).toHaveLength(measured.length);
  });

  test("before the first measurement of the day the whole plan is the day", () => {
    const rows = joinDayRows([], projected);
    expect(rows.map((r) => r.t.getTime())).toEqual([T0 - SLOT, T0, T0 + SLOT, T0 + 2 * SLOT]);
  });

  test("with no plan the day ends at the last measurement", () => {
    expect(joinDayRows(measured, [])).toEqual(measured);
    expect(joinDayRows([], [])).toEqual([]);
  });
});
