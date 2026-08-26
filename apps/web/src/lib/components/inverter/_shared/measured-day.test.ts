import { describe, expect, it } from "bun:test";
import {
  MEASURED_PRODUCTION_DERIVATION,
  measuredFromHourlyEnergy,
  measuredFromRollups,
  measuredTotal,
  slotCount,
  slotIndexAt,
  slotLabelAt,
} from "./measured-day";

/**
 * These cases exist because of a real incident: the solar-forecast dialog showed
 * "Actual 6.9 kWh" for a day the overview Production card reported as 11.8 kWh.
 *
 * The two numbers come from different subsystems by design — the card reads the
 * inverter's own `production.today` register, the dialog integrates minute
 * rollups of `pv.total.power` so it can draw a per-slot curve against the
 * forecast. A few percent of drift between them is expected.
 *
 * A 41 % gap is not drift. Slots where SunReye recorded nothing (server
 * restart, Modbus outage, flush failure) came back `null`, and the headline
 * folded `null` to `0` W — so "we did not measure this hour" was priced as
 * "the array produced nothing this hour" and printed under the label "Actual".
 *
 * The register keeps climbing through an outage; the reconstruction cannot. So
 * the total must always be reported with the coverage that produced it.
 */

const rollup = (time: string, avg: number, max = avg) => ({ time, avg, max });

/** A minute rollup at a local wall-clock time on an arbitrary day. */
const at = (hh: number, mm: number, avg: number, max = avg) =>
  rollup(new Date(2026, 6, 15, hh, mm).toISOString(), avg, max);

describe("slot grid", () => {
  it("60-minute steps give 24 slots; 15-minute steps give 96", () => {
    expect(slotCount(60)).toBe(24);
    expect(slotCount(15)).toBe(96);
  });

  it("a step that does not divide the day still covers it — 7 min ⇒ 206 slots", () => {
    // Ceil, not floor: the tail minutes of the day still need somewhere to land.
    expect(slotCount(7)).toBe(206);
  });

  it("a zero or negative step degrades to 1 minute instead of dividing by zero", () => {
    // stepMinutes arrives from a server payload; 0 must not produce Infinity slots.
    expect(slotCount(0)).toBe(1440);
    expect(slotCount(-15)).toBe(1440);
    expect(Number.isFinite(slotCount(0))).toBe(true);
  });

  it("maps wall-clock to the slot containing it, not the next one", () => {
    expect(slotIndexAt(15, 0, 0)).toBe(0);
    expect(slotIndexAt(15, 0, 14)).toBe(0);
    expect(slotIndexAt(15, 0, 15)).toBe(1);
    expect(slotIndexAt(60, 23, 59)).toBe(23);
  });

  it("labels a slot by its start time, zero-padded", () => {
    expect(slotLabelAt(15, 0)).toBe("00:00");
    expect(slotLabelAt(15, 1)).toBe("00:15");
    expect(slotLabelAt(60, 9)).toBe("09:00");
    expect(slotLabelAt(15, 95)).toBe("23:45");
  });
});

describe("measuredFromRollups", () => {
  it("averages the minutes that landed in a slot and keeps the peak", () => {
    const day = measuredFromRollups([at(9, 0, 1000, 1200), at(9, 30, 2000, 2400)], 60);
    expect(day.avgW[9]).toBe(1500);
    expect(day.peakW[9]).toBe(2400);
  });

  it("a slot with no rows is null — not measured is not zero produced", () => {
    // The whole incident in one assertion. `0` would claim the array was idle.
    const day = measuredFromRollups([at(9, 0, 1000)], 60);
    expect(day.avgW[9]).toBe(1000);
    expect(day.avgW[10]).toBeNull();
    expect(day.peakW[10]).toBeNull();
  });

  it("a genuine zero reading is kept as 0, distinct from null", () => {
    // A shaded array at 07:00 really did produce 0 W. That is a measurement.
    const day = measuredFromRollups([at(7, 0, 0, 0)], 60);
    expect(day.avgW[7]).toBe(0);
    expect(day.avgW[8]).toBeNull();
  });

  it("an empty response measures nothing anywhere", () => {
    const day = measuredFromRollups([], 60);
    expect(day.avgW).toHaveLength(24);
    expect(day.avgW.every((w) => w === null)).toBe(true);
  });

  it("negative power (night-time draw on the PV string) is kept, not clamped away", () => {
    const day = measuredFromRollups([at(2, 0, -12, -5)], 60);
    expect(day.avgW[2]).toBe(-12);
  });

  it("rows are bucketed by local wall-clock, so a row cannot leak into another slot", () => {
    const day = measuredFromRollups([at(0, 0, 100), at(23, 59, 900)], 60);
    expect(day.avgW[0]).toBe(100);
    expect(day.avgW[23]).toBe(900);
    expect(day.avgW.filter((w) => w !== null)).toHaveLength(2);
  });

  it("an unparseable timestamp is dropped rather than poisoning a slot with NaN", () => {
    const day = measuredFromRollups([rollup("not-a-date", 500), at(9, 0, 1000)], 60);
    expect(day.avgW[9]).toBe(1000);
    expect(day.avgW.some((w) => w !== null && Number.isNaN(w))).toBe(false);
  });
});

describe("measuredTotal — the headline number", () => {
  it("integrates average W over the slot width into kWh", () => {
    // 2000 W held for one hour = 2 kWh.
    const day = measuredFromRollups([at(12, 0, 2000)], 60);
    expect(measuredTotal(day, 60).kwh).toBeCloseTo(2, 6);
  });

  it("a 15-minute slot at 2000 W is 0.5 kWh, not 2", () => {
    const day = measuredFromRollups([at(12, 0, 2000)], 15);
    expect(measuredTotal(day, 15).kwh).toBeCloseTo(0.5, 6);
  });

  it("reports how many elapsed slots it actually measured", () => {
    // Measured 09:00 and 10:00; it is now 12:30, so 13 slots have elapsed.
    const day = measuredFromRollups([at(9, 0, 1000), at(10, 0, 1000)], 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 12, 30));
    expect(total.coveredSlots).toBe(2);
    expect(total.elapsedSlots).toBe(13);
    expect(total.complete).toBe(false);
  });

  it("THE INCIDENT: a mid-day recording outage is reported as partial, never as the day total", () => {
    // A 12-hour solar day at a steady 1 kW = 12 kWh. Recording dies 09:00–13:00,
    // so the integral can only reach 8 kWh. The old code printed "Actual 8 kWh"
    // with nothing to say the other four hours were never observed.
    const rows = [];
    for (let h = 6; h < 18; h++) if (h < 9 || h >= 13) rows.push(at(h, 0, 1000));

    const day = measuredFromRollups(rows, 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 18, 0));

    expect(total.kwh).toBeCloseTo(8, 6);
    expect(total.coveredSlots).toBe(8);
    expect(total.elapsedSlots).toBe(19);
    // The caller MUST be able to see that this is not the whole day.
    expect(total.complete).toBe(false);
  });

  it("a fully covered elapsed window reports complete, so the UI can state it plainly", () => {
    const rows = Array.from({ length: 13 }, (_, i) => at(i, 0, 1000));
    const day = measuredFromRollups(rows, 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 12, 30));
    expect(total.coveredSlots).toBe(13);
    expect(total.elapsedSlots).toBe(13);
    expect(total.complete).toBe(true);
  });

  it('slots after "now" are not counted as missing — the future is not an outage', () => {
    // At 09:30 only 10 slots have elapsed; the 14 unmeasured evening slots are
    // simply the future and must not drag coverage down.
    const rows = Array.from({ length: 10 }, (_, i) => at(i, 0, 500));
    const day = measuredFromRollups(rows, 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 9, 30));
    expect(total.elapsedSlots).toBe(10);
    expect(total.complete).toBe(true);
  });

  it('with no "now" given, the whole day is the window', () => {
    const day = measuredFromRollups([at(12, 0, 1000)], 60);
    const total = measuredTotal(day, 60);
    expect(total.elapsedSlots).toBe(24);
    expect(total.coveredSlots).toBe(1);
    expect(total.complete).toBe(false);
  });

  it("measuring nothing at all is 0 kWh AND zero coverage — never a confident zero", () => {
    const day = measuredFromRollups([], 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 18, 0));
    expect(total.kwh).toBe(0);
    expect(total.coveredSlots).toBe(0);
    expect(total.complete).toBe(false);
  });

  it("a real all-zero day is 0 kWh but fully covered — a confident zero", () => {
    // Snow on the panels. Distinguishing this from the case above is the point.
    const rows = Array.from({ length: 19 }, (_, i) => at(i, 0, 0, 0));
    const day = measuredFromRollups(rows, 60);
    const total = measuredTotal(day, 60, slotIndexAt(60, 18, 0));
    expect(total.kwh).toBe(0);
    expect(total.complete).toBe(true);
  });
});

describe("measuredFromHourlyEnergy — fallback for profiles without pv.total.power", () => {
  const hour = (h: number, productionKwh: number) => ({
    bucket: `2026-07-15T${String(h).padStart(2, "0")}`,
    productionKwh,
  });

  it("spreads one hour of kWh across that hour’s slots as average W", () => {
    const day = measuredFromHourlyEnergy([hour(9, 1)], 15, slotIndexAt(15, 23, 59));
    // 1 kWh over the hour = 1000 W average, on each of the four 15-min slots.
    expect(day.avgW.slice(36, 40)).toEqual([1000, 1000, 1000, 1000]);
  });

  it("THE CURRENT HOUR IS NOT TRUNCATED — energy already produced this hour still counts", () => {
    // It is 09:20. The 09:00 hour reported 1 kWh. Capping the fill at the
    // running slot dropped the rest of the hour from the headline every time
    // the dialog was opened mid-hour.
    const nowIdx = slotIndexAt(15, 9, 20); // slot 37
    const day = measuredFromHourlyEnergy([hour(9, 1)], 15, nowIdx);
    const total = measuredTotal(day, 15, nowIdx);
    expect(total.kwh).toBeCloseTo(1, 6);
  });

  it("does not invent production in hours after the current one", () => {
    const nowIdx = slotIndexAt(60, 9, 30);
    const day = measuredFromHourlyEnergy([hour(9, 1), hour(14, 3)], 60, nowIdx);
    expect(day.avgW[14]).toBeNull();
  });

  it("a zero-production hour is measured as 0, not left unmeasured", () => {
    const day = measuredFromHourlyEnergy([hour(6, 0)], 60, slotIndexAt(60, 12, 0));
    expect(day.avgW[6]).toBe(0);
  });

  it("an unparseable bucket is skipped", () => {
    const day = measuredFromHourlyEnergy(
      [{ bucket: "garbage", productionKwh: 5 }, hour(9, 1)],
      60,
      slotIndexAt(60, 12, 0),
    );
    expect(day.avgW[9]).toBe(1000);
    expect(day.avgW.some((w) => w !== null && Number.isNaN(w))).toBe(false);
  });

  it("reports no peaks — this path has no instantaneous data", () => {
    const day = measuredFromHourlyEnergy([hour(9, 1)], 60, slotIndexAt(60, 12, 0));
    expect(day.peakW.every((p) => p === null)).toBe(true);
  });

  it("an empty series measures nothing", () => {
    const day = measuredFromHourlyEnergy([], 60, slotIndexAt(60, 12, 0));
    expect(day.avgW.every((w) => w === null)).toBe(true);
  });
});

/**
 * Issue #115: this module's kWh is an INTEGRAL over recorded power, not a
 * counter read — and that is why it is the one energy figure exposed to
 * milestone 8's change-only storage. Pinned here by demonstrating the exposure
 * rather than by restating the declaration: thin the same physical hour the way
 * change-only storage would (a sample only when the value moves, so steady
 * minutes leave no row at all) and the figure moves with it.
 *
 * Counter-derived energy does NOT behave this way — see
 * `apps/server/src/energy/cost.test.ts`, "energy derivation per role", where the
 * identical perturbation leaves every reported role's kWh unchanged.
 */
describe("measuredTotal is an integral, so thinning the samples moves it (issue #115)", () => {
  // One hour of PV: 1000 W for forty minutes, then 100 W for twenty.
  const minutes = Array.from({ length: 60 }, (_, m) => ({ m, w: m < 40 ? 1000 : 100 }));
  const dense = minutes.map(({ m, w }) => at(9, m, w));
  // Change-only: a row exists only for the minutes in which the value moved.
  const thinned = minutes
    .filter(({ m, w }) => m === 0 || w !== minutes[m - 1]?.w)
    .map(({ m, w }) => at(9, m, w));

  const kwhOf = (rows: ReturnType<typeof at>[]) =>
    measuredTotal(measuredFromRollups(rows, 60), 60, slotIndexAt(60, 23, 0)).kwh;

  it("declares itself an integral", () => {
    expect(MEASURED_PRODUCTION_DERIVATION).toBe("integral");
  });

  it("the dense recording integrates to the hour's true energy", () => {
    // (1000·40 + 100·20) / 60 = 700 W mean over one hour.
    expect(kwhOf(dense)).toBeCloseTo(0.7, 6);
  });

  it("the change-only recording of the SAME hour reports a different figure", () => {
    // Two surviving samples, weighted equally: (1000 + 100) / 2 = 550 W.
    expect(kwhOf(thinned)).toBeCloseTo(0.55, 6);
    expect(kwhOf(thinned)).not.toBeCloseTo(kwhOf(dense), 3);
  });
});
