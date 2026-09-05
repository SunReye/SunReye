import { describe, expect, test } from "bun:test";
import { measuredDaySeries } from "./day-rows";

const T0 = Date.parse("2026-07-27T12:00:00Z");
const MINUTE = 60_000;

const map = (...entries: [number, number][]) => new Map(entries);
/** A metric the plant does not meter at all — distinct from one reading zero. */
const unmetered = () => new Map<number, number>();

describe("measuredDaySeries", () => {
  test("flips battery/grid signs so the charging and exporting halves stack", () => {
    const { power } = measuredDaySeries({
      pv: map([T0, 8000]),
      batt: map([T0, -2000]),
      grid: map([T0, -5500]),
      soc: map([T0, 55]),
    });
    expect(power[0]).toMatchObject({ loadKw: 0.5, chargeKw: 2, exportKw: 5.5, socPct: 55 });
    const row = power[0]!;
    const stacked = row.loadKw + row.chargeKw + row.exportKw + row.curtailedKw;
    expect(stacked).toBeCloseTo(row.pvKw, 6);
  });

  test("unmetered battery and grid leave the whole PV on the house", () => {
    const { power, soc } = measuredDaySeries({
      pv: map([T0, 3000]),
      batt: unmetered(),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ loadKw: 3, chargeKw: 0, exportKw: 0, socPct: 0 });
    expect(soc).toEqual([]);
  });

  test("a discharging battery is not a charge band", () => {
    // The metered sign convention is discharge-positive; a pack FEEDING the
    // house leaves the whole PV as load.
    const { power } = measuredDaySeries({
      pv: map([T0, 1000]),
      batt: map([T0, 1500]),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ chargeKw: 0, exportKw: 0, loadKw: 1 });
  });

  test("an import from the grid is not an export band", () => {
    const { power } = measuredDaySeries({
      pv: map([T0, 1000]),
      batt: unmetered(),
      grid: map([T0, 2200]),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ exportKw: 0, loadKw: 1 });
  });

  test("charging out of the grid can never push the stack past the measured PV", () => {
    // Grid-charging at first light: the pack takes 3 kW while the array makes 1.
    // The 2 kW that came off the grid is not solar, so the band stops at PV.
    const { power } = measuredDaySeries({
      pv: map([T0, 1000]),
      batt: map([T0, -3000]),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ chargeKw: 1, exportKw: 0, loadKw: 0, pvKw: 1 });
  });

  test("export is clipped to what is left after charging", () => {
    const { power } = measuredDaySeries({
      pv: map([T0, 4000]),
      batt: map([T0, -3000]),
      grid: map([T0, -2000]),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ chargeKw: 3, exportKw: 1, loadKw: 0 });
  });

  test("a negative PV reading before sunrise is floored, not plotted below the axis", () => {
    // Some strings report a small negative DC figure at night; a bar hanging
    // under the axis would read as consumption.
    const { power } = measuredDaySeries({
      pv: map([T0, -20]),
      batt: unmetered(),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ pvKw: 0, loadKw: 0, chargeKw: 0, exportKw: 0 });
  });

  test("nothing is curtailed in hindsight", () => {
    // Curtailment is a projection concept. The measured stack has to sum back to
    // the PV the meter actually saw, or the "Today" half of the chart claims
    // production that never existed.
    const { power } = measuredDaySeries({
      pv: map([T0, 12_000]),
      batt: map([T0, 0]),
      grid: map([T0, 0]),
      soc: unmetered(),
    });
    expect(power[0]).toMatchObject({ curtailedKw: 0, loadKw: 12 });
  });

  test("0 % SOC and a zero threshold are readings, not gaps", () => {
    const { power } = measuredDaySeries({
      pv: map([T0, 1000]),
      batt: unmetered(),
      grid: unmetered(),
      soc: map([T0, 0]),
    });
    expect(power[0]).toMatchObject({ socPct: 0, thresholdKw: 0 });
    expect(power[0]?.t.getTime()).toBe(T0);
  });

  test("a bucket the battery reported nothing in is zero, not carried forward", () => {
    // The join is by timestamp and a missing key is a missing reading. Carrying
    // the previous minute's charge power forward would draw a band the meter
    // never saw.
    const { power } = measuredDaySeries({
      pv: map([T0, 4000], [T0 + MINUTE, 4000]),
      batt: map([T0, -2000]),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power.map((r) => r.chargeKw)).toEqual([2, 0]);
  });

  test("rows come out time-sorted and the SOC track mirrors its map", () => {
    const { power, soc } = measuredDaySeries({
      pv: map([T0 + MINUTE, 2000], [T0, 1000]),
      batt: unmetered(),
      grid: unmetered(),
      soc: map([T0, 40], [T0 + MINUTE, 45]),
    });
    expect(power.map((r) => r.t.getTime())).toEqual([T0, T0 + MINUTE]);
    expect(soc).toEqual([
      { t: T0, socPct: 40 },
      { t: T0 + MINUTE, socPct: 45 },
    ]);
  });

  test("an empty day plots nothing", () => {
    const { power, soc } = measuredDaySeries({
      pv: unmetered(),
      batt: unmetered(),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power).toEqual([]);
    expect(soc).toEqual([]);
  });

  test("long days are decimated but keep the newest sample", () => {
    const entries: [number, number][] = Array.from({ length: 1441 }, (_, i) => [
      T0 + i * MINUTE,
      1000,
    ]);
    const { power } = measuredDaySeries({
      pv: new Map(entries),
      batt: unmetered(),
      grid: unmetered(),
      soc: unmetered(),
    });
    expect(power.length).toBeLessThanOrEqual(721);
    expect(power.at(-1)?.t.getTime()).toBe(T0 + 1440 * MINUTE);
  });
});
