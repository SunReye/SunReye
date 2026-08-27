import { describe, expect, test } from "bun:test";
import {
  MIN_DELTA_SOC,
  MIN_SEGMENTS,
  dischargeSegments,
  dischargeSign,
  estimateCapacity,
  stateOfHealth,
  summariseEstimates,
  type StoredEstimate,
  type PowerInterval,
  type SocSample,
} from "./capacity-estimate";

/**
 * Usable capacity is `energy out / SOC consumed`, and SOH is that against a
 * reference. Both are one division; everything here is about which measurements
 * are allowed to enter it.
 *
 * The pack does not report capacity, so it is inferred — and every input is
 * imperfect in a specific way. SOC is quantised to 1 %, so a shallow segment is
 * mostly rounding. SOC is also a BMS *estimate* that gets recalibrated near full
 * and empty, where it moves without energy moving. And energy only equals the
 * integral while nothing charges the pack mid-segment.
 *
 * So this module is mostly rejection rules, and the tests are mostly about what
 * it refuses.
 */

/** A steady discharge: `w` watts for `minutes`, SOC falling linearly. */
function ramp(opts: {
  startMs?: number;
  socStart: number;
  socEnd: number;
  minutes: number;
  w?: number;
}): { soc: SocSample[]; power: PowerInterval[] } {
  const { startMs = 0, socStart, socEnd, minutes, w = 1000 } = opts;
  const steps = Math.abs(socStart - socEnd);
  const stepMs = (minutes * 60_000) / Math.max(1, steps);
  const soc: SocSample[] = [];
  for (let i = 0; i <= steps; i++) {
    soc.push({
      t: startMs + i * stepMs,
      soc: socStart + (socEnd - socStart) * (i / Math.max(1, steps)),
    });
  }
  return {
    soc,
    power: [{ t: startMs, durMs: minutes * 60_000, w }],
  };
}

describe("dischargeSegments", () => {
  test("finds one segment across a steady deep discharge", () => {
    const { soc, power } = ramp({ socStart: 90, socEnd: 30, minutes: 600, w: 1000 });
    const segs = dischargeSegments(soc, power);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.socStart).toBe(90);
    expect(segs[0]?.socEnd).toBe(30);
    expect(segs[0]?.deltaSoc).toBe(60);
    // 1000 W for 10 h = 10 kWh.
    expect(segs[0]?.energyKwh).toBeCloseTo(10, 6);
  });

  test("integrates each interval by its own duration, not by sample count", () => {
    // The whole reason this reads intervals: a change-only series stores one row
    // for a long hold and many for a burst. Counting rows would weight the burst
    // hundreds of times too heavily.
    // Readings every 10 minutes, so the run is continuous under MAX_GAP_MS —
    // the gap rule is a different test.
    const soc: SocSample[] = Array.from({ length: 7 }, (_, i) => ({
      t: i * 600_000,
      soc: 80 - i * 5,
    }));
    const power: PowerInterval[] = [
      { t: 0, durMs: 3_000_000, w: 100 },
      { t: 3_000_000, durMs: 600_000, w: 6000 },
    ];
    const segs = dischargeSegments(soc, power);
    // 100 W for 50 min + 6000 W for 10 min = 0.0833 + 1.0 kWh.
    expect(segs[0]?.energyKwh).toBeCloseTo(100 * (50 / 60) * 1e-3 + 6000 * (10 / 60) * 1e-3, 6);
  });

  test("refuses a segment shallower than the SOC quantisation can carry", () => {
    // 1 % resolution on a 5-point drop is +/- 20 % on the denominator. A number
    // that uncertain is not a measurement.
    const { soc, power } = ramp({ socStart: 70, socEnd: 65, minutes: 60 });
    expect(dischargeSegments(soc, power)).toHaveLength(0);
    expect(MIN_DELTA_SOC).toBeGreaterThanOrEqual(20);
  });

  test("splits when the pack charges mid-way, and keeps neither half if shallow", () => {
    const soc: SocSample[] = [
      { t: 0, soc: 90 },
      { t: 3_600_000, soc: 80 },
      { t: 7_200_000, soc: 88 },
      { t: 10_800_000, soc: 78 },
    ];
    const power: PowerInterval[] = [
      { t: 0, durMs: 3_600_000, w: 1000 },
      { t: 3_600_000, durMs: 3_600_000, w: -1000 },
      { t: 7_200_000, durMs: 3_600_000, w: 1000 },
    ];
    expect(dischargeSegments(soc, power)).toHaveLength(0);
  });

  test("stops at the top of the range, where the BMS recalibrates", () => {
    // Above the trusted band SOC can sit pinned at 100 while energy flows, or
    // step several points at once when the BMS rebalances. Either way the
    // relationship this measures does not hold there.
    const { soc, power } = ramp({ socStart: 100, socEnd: 40, minutes: 600 });
    const segs = dischargeSegments(soc, power);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.socStart).toBeLessThanOrEqual(95);
  });

  test("stops at the bottom of the range for the same reason", () => {
    const { soc, power } = ramp({ socStart: 90, socEnd: 2, minutes: 600 });
    const segs = dischargeSegments(soc, power);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.socEnd).toBeGreaterThanOrEqual(10);
  });

  test("breaks on a gap in the data rather than bridging it", () => {
    // A missing hour is an hour of unmeasured energy. Bridging it would credit
    // the SOC drop to whatever little energy was recorded and read as a tiny
    // pack.
    const soc: SocSample[] = [
      { t: 0, soc: 90 },
      { t: 3_600_000, soc: 70 },
      { t: 3_600_000 + 6 * 3_600_000, soc: 40 },
    ];
    const power: PowerInterval[] = [
      { t: 0, durMs: 3_600_000, w: 2000 },
      { t: 3_600_000 + 6 * 3_600_000, durMs: 3_600_000, w: 2000 },
    ];
    const segs = dischargeSegments(soc, power);
    for (const s of segs) expect(s.deltaSoc).toBeLessThanOrEqual(30);
  });

  test("carries the mean pack temperature when it is known", () => {
    const { soc, power } = ramp({ socStart: 90, socEnd: 40, minutes: 600 });
    const segs = dischargeSegments(soc, power, {
      temperature: [
        { t: 0, durMs: 300 * 60_000, w: 20 },
        { t: 300 * 60_000, durMs: 300 * 60_000, w: 30 },
      ],
    });
    expect(segs[0]?.meanTempC).toBeCloseTo(25, 6);
  });
});

describe("estimateCapacity", () => {
  /** `n` segments of a 15 kWh pack, each `deltaSoc` deep, with a % error. */
  const segments = (n: number, errPct: (i: number) => number = () => 0, deltaSoc = 40) =>
    Array.from({ length: n }, (_, i) => ({
      startMs: i * 86_400_000,
      endMs: i * 86_400_000 + 3_600_000,
      socStart: 80,
      socEnd: 80 - deltaSoc,
      deltaSoc,
      energyKwh: 15 * (deltaSoc / 100) * (1 + errPct(i) / 100),
    }));

  test("recovers the pack size from clean segments", () => {
    const est = estimateCapacity(segments(8));
    expect(est?.kwh).toBeCloseTo(15, 6);
    expect(est?.segments).toBe(8);
  });

  test("refuses to answer from too few segments", () => {
    expect(estimateCapacity(segments(MIN_SEGMENTS - 1))).toBeNull();
    expect(estimateCapacity([])).toBeNull();
    expect(estimateCapacity(segments(MIN_SEGMENTS))).not.toBeNull();
  });

  test("a single wild segment does not move the answer", () => {
    // The median is the point: one recalibration event that halves the apparent
    // energy would drag a mean by 6 %, and moves this by nothing.
    const clean = segments(9);
    const withOutlier = [...clean, { ...clean[0]!, energyKwh: clean[0]!.energyKwh / 2 }];
    expect(estimateCapacity(withOutlier)?.kwh).toBeCloseTo(15, 6);
  });

  test("reports a band, and the band narrows as the segments agree", () => {
    const noisy = estimateCapacity(segments(20, (i) => (i % 2 === 0 ? 10 : -10)));
    const tight = estimateCapacity(segments(20, (i) => (i % 2 === 0 ? 1 : -1)));
    expect(noisy!.high - noisy!.low).toBeGreaterThan(tight!.high - tight!.low);
    expect(noisy!.low).toBeLessThanOrEqual(noisy!.kwh);
    expect(noisy!.high).toBeGreaterThanOrEqual(noisy!.kwh);
  });

  test("weights nothing by segment depth — every segment is one estimate", () => {
    // A 60-point segment and a 20-point segment each yield one slope. Depth is
    // already a gate (MIN_DELTA_SOC); using it twice would let one long night
    // outvote a fortnight.
    // Six 20-point segments of a 15 kWh pack, four 60-point ones reading 18.
    // Unweighted, the median is 15. Weighted by depth the mean would be 17 —
    // the four deep nights outvoting the six ordinary ones.
    const mixed = [...segments(6, () => 0, 20), ...segments(4, () => 20, 60)];
    expect(estimateCapacity(mixed)?.kwh).toBeCloseTo(15, 6);
  });
});

describe("stateOfHealth", () => {
  test("is the estimate against the nameplate when one is configured", () => {
    expect(stateOfHealth(13.5, { nameplateKwh: 15 })?.ratio).toBeCloseTo(0.9, 6);
    expect(stateOfHealth(13.5, { nameplateKwh: 15 })?.reference).toBe("nameplate");
  });

  test("falls back to this install's own baseline when no nameplate is set", () => {
    const soh = stateOfHealth(13.5, { baselineKwh: 15 });
    expect(soh?.ratio).toBeCloseTo(0.9, 6);
    expect(soh?.reference).toBe("baseline");
  });

  test("prefers the nameplate when both are known", () => {
    // The baseline is whatever this install first measured, which is already
    // degraded on a pack that was not new when SunReye met it.
    expect(stateOfHealth(13.5, { nameplateKwh: 15, baselineKwh: 14 })?.reference).toBe("nameplate");
  });

  test("is null with no reference at all, never 100 %", () => {
    expect(stateOfHealth(13.5, {})).toBeNull();
  });

  test("does not cap at 100 % — a pack above its nameplate is a real answer", () => {
    // New packs routinely measure above nameplate, and clamping would hide a
    // nameplate that was entered wrong.
    expect(stateOfHealth(16, { nameplateKwh: 15 })?.ratio).toBeCloseTo(1.0667, 4);
  });

  test("rejects a nonsense reference rather than dividing by it", () => {
    expect(stateOfHealth(13.5, { nameplateKwh: 0 })).toBeNull();
    expect(stateOfHealth(13.5, { nameplateKwh: -1 })).toBeNull();
  });
});

describe("dischargeSign", () => {
  /** SOC falling 80 → 40 over 4 h while power reads `w`. */
  const falling = (w: number) => ({
    soc: [
      { t: 0, soc: 80 },
      { t: 3_600_000, soc: 70 },
      { t: 7_200_000, soc: 60 },
      { t: 10_800_000, soc: 50 },
      { t: 14_400_000, soc: 40 },
    ],
    power: [{ t: 0, durMs: 14_400_000, w }],
  });

  test("reads positive-means-discharge from a pack that emptied while power was positive", () => {
    const { soc, power } = falling(1000);
    expect(dischargeSign(soc, power)).toBe(1);
  });

  test("reads the opposite convention just as happily", () => {
    // `generic-sim.ts` documents exactly this sign, and a profile may map it.
    // Assuming the Deye convention would measure the CHARGE side and report a
    // capacity inflated by the round-trip losses — silently.
    const { soc, power } = falling(-1000);
    expect(dischargeSign(soc, power)).toBe(-1);
  });

  test("says nothing when the pack never moved", () => {
    const flat = [
      { t: 0, soc: 50 },
      { t: 3_600_000, soc: 50 },
    ];
    expect(dischargeSign(flat, [{ t: 0, durMs: 3_600_000, w: 1000 }])).toBeNull();
  });

  test("says nothing when the pack was idle throughout", () => {
    const { soc } = falling(0);
    expect(dischargeSign(soc, [{ t: 0, durMs: 14_400_000, w: 1 }])).toBeNull();
  });

  test("survives a minority of contradictory readings", () => {
    // A pack that charged briefly mid-window votes the other way once; the
    // majority still decides.
    const soc = [
      { t: 0, soc: 80 },
      { t: 3_600_000, soc: 70 },
      { t: 7_200_000, soc: 75 },
      { t: 10_800_000, soc: 60 },
      { t: 14_400_000, soc: 50 },
    ];
    const power: PowerInterval[] = [
      { t: 0, durMs: 3_600_000, w: 1000 },
      { t: 3_600_000, durMs: 3_600_000, w: -1000 },
      { t: 7_200_000, durMs: 7_200_000, w: 1000 },
    ];
    expect(dischargeSign(soc, power)).toBe(1);
  });
});

describe("summariseEstimates", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2027, 0, 1);
  const RECENT = 180 * DAY;

  /** One stored estimate `daysAgo` old, for a pack measuring `kwh`. */
  const at = (daysAgo: number, kwh: number): StoredEstimate => ({
    measuredAtMs: NOW - daysAgo * DAY,
    segment: {
      startMs: NOW - daysAgo * DAY - 3_600_000,
      endMs: NOW - daysAgo * DAY,
      socStart: 80,
      socEnd: 40,
      deltaSoc: 40,
      energyKwh: kwh * 0.4,
    },
  });

  const summary = (stored: StoredEstimate[], nameplateKwh?: number) =>
    summariseEstimates(stored, { nowMs: NOW, recentWindowMs: RECENT, nameplateKwh });

  test("measures a degrading pack against its own first readings", () => {
    const stored = [
      ...Array.from({ length: 5 }, (_, i) => at(900 - i, 15)),
      ...Array.from({ length: 5 }, (_, i) => at(30 - i, 13.5)),
    ];
    const s = summary(stored);
    expect(s.baseline?.kwh).toBeCloseTo(15, 6);
    expect(s.capacity?.kwh).toBeCloseTo(13.5, 6);
    expect(s.health?.reference).toBe("baseline");
    expect(s.health?.ratio).toBeCloseTo(0.9, 6);
  });

  test("the nameplate wins over the baseline when both exist", () => {
    const stored = Array.from({ length: 6 }, (_, i) => at(30 - i, 13.5));
    const s = summary(stored, 15);
    expect(s.health?.reference).toBe("nameplate");
    expect(s.health?.ratio).toBeCloseTo(0.9, 6);
  });

  test("the baseline is the median of the first segments, not the best of them", () => {
    // One lucky early reading of 18 among 15s. Anchoring on the maximum would
    // report a permanent 17 % degradation that never happened.
    const stored = [
      at(900, 18),
      ...Array.from({ length: 4 }, (_, i) => at(899 - i, 15)),
      ...Array.from({ length: 5 }, (_, i) => at(30 - i, 15)),
    ];
    expect(summary(stored).baseline?.kwh).toBeCloseTo(15, 6);
    expect(summary(stored).health?.ratio).toBeCloseTo(1, 6);
  });

  test("old segments still count toward the baseline, never toward the current capacity", () => {
    // The two windows are filtered separately on purpose: everything the
    // baseline needs is, by definition, outside the recent window.
    const stored = Array.from({ length: 6 }, (_, i) => at(900 - i, 15));
    const s = summary(stored);
    expect(s.baseline?.kwh).toBeCloseTo(15, 6);
    expect(s.capacity).toBeNull();
    expect(s.health).toBeNull();
  });

  test("reports nothing rather than a default before enough has been measured", () => {
    const s = summary([at(10, 15), at(9, 15)]);
    expect(s.capacity).toBeNull();
    expect(s.baseline).toBeNull();
    expect(s.health).toBeNull();
  });

  test("a nameplate alone is enough — no baseline required", () => {
    const stored = Array.from({ length: 5 }, (_, i) => at(30 - i, 14));
    const s = summary(stored, 15);
    expect(s.health?.reference).toBe("nameplate");
    expect(s.baseline?.kwh).toBeCloseTo(14, 6);
  });
});
