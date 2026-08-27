import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { DecisionPoint, PeakShavingPlan, PlanSlot } from "$lib/automations";
import {
  joinDayRows,
  measuredDaySeries,
  toMeasuredRows,
  toPlanRows,
  toSocRows,
  todayPoints,
} from "./plan-series";

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

/** One sample off the decision ring, with only the metered fields that matter. */
const measuredPoint = (over: Partial<DecisionPoint> = {}): DecisionPoint => ({
  ...historyPoint(T0, 55),
  pvW: 8000,
  thresholdW: 5500,
  chargeW: 2000,
  exportW: 5500,
  ...over,
});

describe("toMeasuredRows", () => {
  test("the metered halves come out of the PV and the house keeps the rest", () => {
    const [row] = toMeasuredRows([measuredPoint()]);
    expect(row).toMatchObject({ loadKw: 0.5, chargeKw: 2, exportKw: 5.5, pvKw: 8 });
    const stacked = row!.loadKw + row!.chargeKw + row!.exportKw + row!.curtailedKw;
    expect(stacked).toBeCloseTo(row!.pvKw, 6);
  });

  test("nothing is curtailed in hindsight", () => {
    // Curtailment is a projection concept. The measured stack has to sum back to
    // the PV the meter actually saw, or the "Today" half of the chart claims
    // production that never existed.
    const [row] = toMeasuredRows([measuredPoint({ pvW: 12_000, chargeW: 0, exportW: 0 })]);
    expect(row!.curtailedKw).toBe(0);
    expect(row!.loadKw).toBe(12);
  });

  test("a discharging battery is not a charge band", () => {
    // The metered sign convention is charge-positive; a discharge (negative) is
    // the pack *feeding* the house, so the whole PV is still load.
    const [row] = toMeasuredRows([measuredPoint({ pvW: 1000, chargeW: -1500, exportW: 0 })]);
    expect(row).toMatchObject({ chargeKw: 0, exportKw: 0, loadKw: 1 });
  });

  test("an import from the grid is not an export band", () => {
    const [row] = toMeasuredRows([measuredPoint({ pvW: 1000, chargeW: 0, exportW: -2200 })]);
    expect(row).toMatchObject({ exportKw: 0, loadKw: 1 });
  });

  test("charging out of the grid can never push the stack past the measured PV", () => {
    // Grid-charging at first light: the pack takes 3 kW while the array makes 1.
    // The 2 kW that came off the grid is not solar, so the band stops at PV.
    const [row] = toMeasuredRows([measuredPoint({ pvW: 1000, chargeW: 3000, exportW: 0 })]);
    expect(row).toMatchObject({ chargeKw: 1, exportKw: 0, loadKw: 0, pvKw: 1 });
  });

  test("export is clipped to what is left after charging", () => {
    const [row] = toMeasuredRows([measuredPoint({ pvW: 4000, chargeW: 3000, exportW: 2000 })]);
    expect(row).toMatchObject({ chargeKw: 3, exportKw: 1, loadKw: 0 });
  });

  test("a negative PV reading before sunrise is floored, not plotted below the axis", () => {
    // Some strings report a small negative DC figure at night; a bar hanging
    // under the axis would read as consumption.
    const [row] = toMeasuredRows([measuredPoint({ pvW: -20, chargeW: null, exportW: null })]);
    expect(row).toMatchObject({ pvKw: 0, loadKw: 0, chargeKw: 0, exportKw: 0 });
  });

  test("an unmetered plant leaves the whole PV on the house", () => {
    const [row] = toMeasuredRows([measuredPoint({ pvW: 3000, chargeW: null, exportW: null })]);
    expect(row).toMatchObject({ loadKw: 3, chargeKw: 0, exportKw: 0 });
  });

  test("0 % SOC and a zero threshold are readings, not gaps", () => {
    const [row] = toMeasuredRows([measuredPoint({ socPct: 0, thresholdW: 0 })]);
    expect(row).toMatchObject({ socPct: 0, thresholdKw: 0 });
    expect(row!.t.getTime()).toBe(T0);
  });

  test("an empty ring plots nothing", () => {
    expect(toMeasuredRows([])).toEqual([]);
  });
});

describe("todayPoints", () => {
  // The ring holds more than a day, so "Today" is a cut at local midnight.
  const NOW = new Date(2026, 7, 2, 0, 5);
  const MIDNIGHT = new Date(2026, 7, 2).getTime();

  afterEach(() => setSystemTime());

  test("a sample from the far side of midnight is not part of today", () => {
    // Five minutes after midnight the ring is almost all yesterday. Carrying it
    // over would draw last evening's production onto the new day.
    setSystemTime(NOW);
    const points = [
      historyPoint(MIDNIGHT - 60 * 60_000, 30),
      historyPoint(MIDNIGHT - 1, 31),
      historyPoint(MIDNIGHT, 32),
      historyPoint(MIDNIGHT + 5 * 60_000, 33),
    ];
    expect(todayPoints(points).map((p) => p.socPct)).toEqual([32, 33]);
  });

  test("the sample exactly at midnight opens the day", () => {
    setSystemTime(NOW);
    expect(todayPoints([historyPoint(MIDNIGHT, 40)])).toHaveLength(1);
  });

  test("late in the evening the whole day is still there", () => {
    setSystemTime(new Date(2026, 7, 2, 23, 45));
    const points = [
      historyPoint(MIDNIGHT - 1, 20),
      historyPoint(MIDNIGHT, 21),
      historyPoint(MIDNIGHT + 12 * 3_600_000, 22),
    ];
    expect(todayPoints(points).map((p) => p.socPct)).toEqual([21, 22]);
    expect(todayPoints([])).toEqual([]);
  });
});

describe("joinDayRows", () => {
  const measured = toMeasuredRows([measuredPoint({ t: T0 - SLOT }), measuredPoint({ t: T0 })]);
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
