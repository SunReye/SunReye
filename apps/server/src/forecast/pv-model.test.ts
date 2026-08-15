import { describe, expect, test } from "bun:test";
import { STC_CELL_TEMP_C, pvPowerW } from "./pv-model";
import { type SunPosition, cosAoi, sunPosition } from "./solar-geometry";

// Model constants restated here on purpose: if someone retunes the physics, the
// expected numbers below must be re-derived deliberately, not silently inherited.
const NOCT_RISE_PER_WM2 = 25 / 800; // 0.03125 °C per W/m²
const IAM_DIFFUSE = 0.95;

/** Ambient temperature that puts the cells at exactly STC (25 °C) under `gti`,
 * using the NOCT fallback. Lets a test isolate optics from the temperature term. */
const ambientForStcCells = (gti: number) => STC_CELL_TEMP_C - gti * NOCT_RISE_PER_WM2;

/** Optics-only probe: 1 kWp, no temperature derate, no system loss, so the
 * returned watts equal the effective (post-IAM) irradiance in W/m². */
const effectiveWm2 = (sample: Parameters<typeof pvPowerW>[0]) => pvPowerW(sample, 1, 0, 0);

/** The bare Martin–Ruiz modifier at one incidence cosine. A clear-sky,
 * beam-only plane: the plane total *is* the projected beam (GTI = DNI·cosAoi),
 * so there is no diffuse remainder and effective ÷ GTI is the modifier itself.
 * Keeping DNI at a real 1000 W/m² matters — a fictitious DNI large enough to
 * saturate the beam cap at every cosine only exists above the solar constant. */
const iamAt = (cosAoiValue: number) => {
  const dniWm2 = 1000;
  const gtiWm2 = dniWm2 * cosAoiValue;
  return effectiveWm2({ gtiWm2, ambientC: 20, dniWm2, cosAoi: cosAoiValue }) / gtiWm2;
};

describe("pvPowerW", () => {
  test("zero at night and never negative", () => {
    expect(pvPowerW({ gtiWm2: 0, ambientC: 15 }, 10, -0.4, 14)).toBe(0);
    expect(pvPowerW({ gtiWm2: -5, ambientC: 15 }, 10, -0.4, 14)).toBe(0);
  });

  test("STC-ish conditions yield roughly kWp minus losses", () => {
    // 1000 W/m² with cells at exactly 25 °C (ambient 25 - rise 31.25 ≈ -6.25).
    const w = pvPowerW({ gtiWm2: 1000, ambientC: 25 - (1000 * 25) / 800 }, 10, -0.4, 14);
    expect(w).toBeCloseTo(10 * 1000 * 0.86, 0);
  });

  test("hot cells produce less than cool cells at equal irradiance", () => {
    const cool = pvPowerW({ gtiWm2: 800, ambientC: 5 }, 10, -0.4, 14);
    const hot = pvPowerW({ gtiWm2: 800, ambientC: 35 }, 10, -0.4, 14);
    expect(hot).toBeLessThan(cool);
  });

  test("temperature coefficient of zero disables derating", () => {
    const w = pvPowerW({ gtiWm2: 500, ambientC: 40 }, 10, 0, 0);
    expect(w).toBeCloseTo(5000, 5);
  });

  test("normal-incidence beam loses nothing to the IAM", () => {
    // All 300 W/m² arrives as beam straight onto the glass: IAM(1) = 1, no
    // diffuse remainder — identical to the model without the split.
    const withIam = pvPowerW({ gtiWm2: 300, ambientC: 20, dniWm2: 400, cosAoi: 1 }, 10, -0.4, 14);
    const legacy = pvPowerW({ gtiWm2: 300, ambientC: 20 }, 10, -0.4, 14);
    expect(withIam).toBeCloseTo(legacy, 6);
  });

  test("glancing beam is derated harder than the flat system loss", () => {
    const glancing = pvPowerW(
      { gtiWm2: 300, ambientC: 20, dniWm2: 600, cosAoi: 0.15 },
      10,
      -0.4,
      14,
    );
    const legacy = pvPowerW({ gtiWm2: 300, ambientC: 20 }, 10, -0.4, 14);
    expect(glancing).toBeLessThan(legacy);
  });

  test("sun behind the plane leaves only diffuse light", () => {
    // Temp coefficient zeroed: cells heat with the *full* incident GTI, not the
    // post-IAM effective irradiance, so only the optical path is compared here.
    const behind = pvPowerW({ gtiWm2: 100, ambientC: 20, dniWm2: 500, cosAoi: -0.3 }, 10, 0, 14);
    const allDiffuse = pvPowerW({ gtiWm2: 100 * 0.95, ambientC: 20 }, 10, 0, 14);
    expect(behind).toBeCloseTo(allDiffuse, 6);
  });

  test("wind cools the cells and lifts output (Faiman)", () => {
    const calm = pvPowerW({ gtiWm2: 800, ambientC: 30, windMs: 0.5 }, 10, -0.4, 14);
    const windy = pvPowerW({ gtiWm2: 800, ambientC: 30, windMs: 6 }, 10, -0.4, 14);
    expect(windy).toBeGreaterThan(calm);
  });

  test("~1 m/s wind matches the NOCT fallback within a few percent", () => {
    const faiman = pvPowerW({ gtiWm2: 1000, ambientC: 25, windMs: 1 }, 10, -0.4, 14);
    const noct = pvPowerW({ gtiWm2: 1000, ambientC: 25 }, 10, -0.4, 14);
    expect(Math.abs(faiman - noct) / noct).toBeLessThan(0.02);
  });
});

describe("pvPowerW — irradiance boundaries", () => {
  test("a night sample is exactly 0 W, not a rounding-small number", () => {
    // Downstream energy integration sums these; a 1e-9 W floor would still be
    // charted as "production" at 03:00 and destroy trust in the forecast.
    expect(pvPowerW({ gtiWm2: 0, ambientC: -7.5 }, 10, -0.4, 14)).toBe(0);
    expect(Object.is(pvPowerW({ gtiWm2: 0, ambientC: 20 }, 10, -0.4, 14), 0)).toBe(true);
  });

  test("a negative GTI (sensor/model artefact) yields 0, never negative watts", () => {
    expect(pvPowerW({ gtiWm2: -250, ambientC: 20 }, 10, -0.4, 14)).toBe(0);
    // Also through the IAM path, where the beam/diffuse split could sign-flip.
    expect(pvPowerW({ gtiWm2: -250, ambientC: 20, dniWm2: 100, cosAoi: 0.5 }, 10, -0.4, 14)).toBe(
      0,
    );
  });

  test("output scales linearly with irradiance at fixed cell temperature", () => {
    // Cell temp pinned by supplying the ambient that lands on STC for each GTI,
    // so any non-linearity here is optics/DC, not the temperature term.
    const at = (g: number) => pvPowerW({ gtiWm2: g, ambientC: ambientForStcCells(g) }, 10, -0.4, 0);
    expect(at(500)).toBeCloseTo(at(1000) / 2, 6);
    expect(at(1)).toBeCloseTo(at(1000) / 1000, 9);
  });

  test("1 W/m² of dawn light is not rounded away to zero", () => {
    expect(pvPowerW({ gtiWm2: 1, ambientC: 5 }, 10, -0.4, 14)).toBeGreaterThan(0);
  });

  test("irradiance above STC (cloud-edge enhancement) is not clipped to nameplate", () => {
    // 1200 W/m² happens on cloud-edge days; the model is a physics model, not an
    // inverter clipping model, so it must report the honest DC number.
    const boosted = pvPowerW({ gtiWm2: 1200, ambientC: ambientForStcCells(1200) }, 10, -0.4, 0);
    expect(boosted).toBeCloseTo(12_000, 6);
  });
});

describe("pvPowerW — array size boundaries", () => {
  test("a 0 kWp array produces 0 W in full sun", () => {
    // A newly-added, not-yet-sized array must contribute nothing rather than NaN.
    expect(pvPowerW({ gtiWm2: 1000, ambientC: 20 }, 0, -0.4, 14)).toBe(0);
  });

  test("a negative kWp (bad config) clamps to 0 rather than draining the forecast", () => {
    expect(pvPowerW({ gtiWm2: 1000, ambientC: 20 }, -10, -0.4, 14)).toBe(0);
  });

  test("output scales linearly with kWp", () => {
    const s = { gtiWm2: 700, ambientC: 18 };
    expect(pvPowerW(s, 20, -0.4, 14)).toBeCloseTo(2 * pvPowerW(s, 10, -0.4, 14), 6);
  });

  test("a fractional balcony array (0.4 kWp) is modelled, not floored away", () => {
    const w = pvPowerW({ gtiWm2: 1000, ambientC: ambientForStcCells(1000) }, 0.4, -0.4, 0);
    expect(w).toBeCloseTo(400, 6);
  });
});

describe("pvPowerW — temperature derate", () => {
  test("cells at exactly 25 °C are undereated: STC is the hinge, not a range", () => {
    const gti = 800;
    const w = pvPowerW({ gtiWm2: gti, ambientC: ambientForStcCells(gti) }, 10, -0.4, 0);
    expect(w).toBeCloseTo(10 * gti, 6);
  });

  test("cells below 25 °C gain output — a winter array beats its nameplate ratio", () => {
    // −7.5 °C ambient, 200 W/m²: cells at −1.25 °C, 26.25 K below STC.
    // derate = 1 + (−0.4/100)(−26.25) = 1.105 → 2210 W from a 10 kWp array.
    const w = pvPowerW({ gtiWm2: 200, ambientC: -7.5 }, 10, -0.4, 0);
    expect(w).toBeCloseTo(2210, 6);
    expect(w).toBeGreaterThan(10 * 200);
  });

  test("0 °C ambient is a temperature, not a missing reading", () => {
    // Guards against any future `if (!ambientC)` style presence check: freezing
    // point must derate exactly like −0.001 °C, not fall back to something else.
    const atZero = pvPowerW({ gtiWm2: 600, ambientC: 0 }, 10, -0.4, 14);
    const justBelow = pvPowerW({ gtiWm2: 600, ambientC: -0.001 }, 10, -0.4, 14);
    expect(atZero).toBeCloseTo(justBelow, 1);
    expect(atZero).toBeGreaterThan(pvPowerW({ gtiWm2: 600, ambientC: 10 }, 10, -0.4, 14));
  });

  test("deep frost (−25 °C) still produces sane, bounded power", () => {
    const w = pvPowerW({ gtiWm2: 400, ambientC: -25 }, 10, -0.4, 14);
    // cells at −12.5 °C → derate 1.15, minus 14 % loss.
    expect(w).toBeCloseTo(10 * 400 * 1.15 * 0.86, 6);
  });

  test("an absurd coefficient cannot invert the array into a load", () => {
    // derate would go to −4.3125 at 131 °C cells with −5 %/°C; the clamp keeps
    // the array at 0 W instead of feeding negative watts into the day total.
    expect(pvPowerW({ gtiWm2: 1000, ambientC: 100 }, 10, -5, 14)).toBe(0);
  });

  test("the derate clamp engages exactly at the zero-output cell temperature", () => {
    // −2 %/°C (the schema's floor) hits derate = 0 at 50 K above STC → 75 °C cells.
    const ambientAt75 = 75 - 1000 * NOCT_RISE_PER_WM2;
    expect(pvPowerW({ gtiWm2: 1000, ambientC: ambientAt75 }, 10, -2, 0)).toBeCloseTo(0, 6);
    expect(pvPowerW({ gtiWm2: 1000, ambientC: ambientAt75 - 1 }, 10, -2, 0)).toBeGreaterThan(0);
    expect(pvPowerW({ gtiWm2: 1000, ambientC: ambientAt75 + 50 }, 10, -2, 0)).toBe(0);
  });

  test("STC_CELL_TEMP_C is the 25 °C datasheet reference the coefficient hangs on", () => {
    // Pinning the number alone is a tautology — a literal compared with a
    // literal, true even if nothing read it. Pin it *and* show the model pivots
    // there: at exactly this cell temperature the derate is 1, and one kelvin
    // either side moves output by exactly the datasheet coefficient.
    expect(STC_CELL_TEMP_C).toBe(25);

    const atCell = (cellC: number) =>
      pvPowerW({ gtiWm2: 1000, ambientC: cellC - 1000 * NOCT_RISE_PER_WM2 }, 10, -0.4, 0);
    expect(atCell(STC_CELL_TEMP_C)).toBeCloseTo(10_000, 6);
    expect(atCell(STC_CELL_TEMP_C + 1)).toBeCloseTo(10_000 * 0.996, 6);
    expect(atCell(STC_CELL_TEMP_C - 1)).toBeCloseTo(10_000 * 1.004, 6);
  });
});

describe("pvPowerW — system losses", () => {
  const stc = { gtiWm2: 1000, ambientC: ambientForStcCells(1000) };

  test("0 % loss passes the full DC through — 0 is a setting, not 'unset'", () => {
    expect(pvPowerW(stc, 10, -0.4, 0)).toBeCloseTo(10_000, 6);
  });

  test("100 % loss produces exactly 0 W", () => {
    expect(pvPowerW(stc, 10, -0.4, 100)).toBe(0);
  });

  test("losses beyond 100 % clamp at 0 instead of going negative", () => {
    expect(pvPowerW(stc, 10, -0.4, 150)).toBe(0);
  });

  test("the schema's 90 % ceiling leaves a tenth of the DC", () => {
    expect(pvPowerW(stc, 10, -0.4, 90)).toBeCloseTo(1000, 6);
  });

  test("loss is a plain multiplicative factor across the range", () => {
    const full = pvPowerW(stc, 10, -0.4, 0);
    for (const pct of [1, 14, 25, 50, 99]) {
      expect(pvPowerW(stc, 10, -0.4, pct)).toBeCloseTo(full * (1 - pct / 100), 6);
    }
  });
});

describe("pvPowerW — incidence-angle modifier", () => {
  test("a present cosAoi of 0 means grazing sun, not missing geometry", () => {
    // 0 is falsy: were the presence check `if (!sample.cosAoi)`, this sample
    // would silently fall back to raw GTI and over-forecast the beam.
    const grazing = effectiveWm2({ gtiWm2: 400, ambientC: 20, dniWm2: 900, cosAoi: 0 });
    expect(grazing).toBeCloseTo(400 * IAM_DIFFUSE, 6);
    expect(grazing).toBeLessThan(effectiveWm2({ gtiWm2: 400, ambientC: 20 }));
  });

  test("a present DNI of 0 (fully overcast) is all-diffuse, not missing data", () => {
    const overcast = effectiveWm2({ gtiWm2: 400, ambientC: 20, dniWm2: 0, cosAoi: 0.8 });
    expect(overcast).toBeCloseTo(400 * IAM_DIFFUSE, 6);
  });

  test("one half of the split missing falls back to raw GTI (no beam IAM on cloud)", () => {
    // Applying a beam modifier to total irradiance would under-forecast every
    // cloudy hour, so a partial provider payload must degrade, not guess.
    expect(effectiveWm2({ gtiWm2: 400, ambientC: 20, dniWm2: 900 })).toBeCloseTo(400, 6);
    expect(effectiveWm2({ gtiWm2: 400, ambientC: 20, cosAoi: 0.9 })).toBeCloseTo(400, 6);
  });

  test("beam is capped by the GTI when DNI·cosAoi overshoots it", () => {
    // Providers mix models; an unclipped beam would exceed the plane's own total
    // and manufacture a negative diffuse component.
    const capped = effectiveWm2({ gtiWm2: 500, ambientC: 20, dniWm2: 1000, cosAoi: 1 });
    expect(capped).toBeCloseTo(500, 6); // IAM(1) = 1, diffuse remainder = 0
    expect(capped).toBeLessThanOrEqual(500);
  });

  test("IAM is 1 at normal incidence and monotonic as the sun drops to grazing", () => {
    const cosines = [1, 0.9, 0.7, 0.5, 0.3, 0.15, 0.05];
    const iam = cosines.map(iamAt);
    // Head-on beam is transmitted whole; every further degree off the normal
    // reflects strictly more of it.
    expect(iam[0]).toBeCloseTo(1, 12);
    for (let i = 1; i < iam.length; i++) expect(iam[i]).toBeLessThan(iam[i - 1] as number);
    // The drop is gentle for most of the day and collapses only near grazing:
    // ~1 % lost by 45°, but two thirds of the beam gone at 87°.
    expect(iam[2]).toBeGreaterThan(0.98); // cos 0.7 ≈ 45°
    expect(iam[iam.length - 1]).toBeLessThan(0.3);
  });

  test("Martin–Ruiz values match the published curve at 60° and 87° incidence", () => {
    // ar = 0.16 glass: IAM(cos 0.5, 60° AoI) = 0.9579,
    // IAM(cos 0.05, ≈87°, a low winter sun) = 0.2689.
    expect(iamAt(0.5)).toBeCloseTo(0.9579, 4);
    expect(iamAt(0.05)).toBeCloseTo(0.2689, 4);
  });

  test("a sun exactly on the plane's edge (cosAoi 0) kills the beam entirely", () => {
    const edge = effectiveWm2({ gtiWm2: 300, ambientC: 20, dniWm2: 800, cosAoi: 0 });
    const behind = effectiveWm2({ gtiWm2: 300, ambientC: 20, dniWm2: 800, cosAoi: -1 });
    expect(edge).toBeCloseTo(behind, 9);
    expect(edge).toBeCloseTo(300 * IAM_DIFFUSE, 6);
  });

  test("cells still heat with the full incident sun, not the post-IAM share", () => {
    // Reflected light is not absorbed as power but the plane sits in the same
    // sun; a model that cooled the cells by the IAM would over-forecast hot,
    // low-sun afternoons. Same effective 760 W/m², different GTI → different W.
    const reflecting = pvPowerW({ gtiWm2: 800, ambientC: 20, dniWm2: 0, cosAoi: 1 }, 10, -0.4, 0); // effective = 800 × 0.95 = 760, cells at 45 °C
    const direct = pvPowerW({ gtiWm2: 760, ambientC: 20 }, 10, -0.4, 0); // cells at 43.75 °C
    expect(reflecting).toBeLessThan(direct);
    expect(reflecting).toBeCloseTo(10 * 760 * (1 - 0.004 * (45 - 25)), 6);
  });
});

describe("pvPowerW — wind cooling", () => {
  test("0 m/s is dead calm, not 'no wind data' — it heats cells past NOCT", () => {
    // The single most dangerous falsy check in this file: `if (!windMs)` would
    // silently swap the Faiman model for NOCT on every still hour.
    const calm = pvPowerW({ gtiWm2: 1000, ambientC: 25, windMs: 0 }, 10, -0.4, 0);
    const noWindData = pvPowerW({ gtiWm2: 1000, ambientC: 25 }, 10, -0.4, 0);
    expect(calm).toBeCloseTo(8400, 6); // rise 1000/25 = 40 K → cells 65 °C
    expect(noWindData).toBeCloseTo(8750, 6); // NOCT rise 31.25 K → cells 56.25 °C
    expect(calm).toBeLessThan(noWindData);
  });

  test("cooling saturates: a storm cannot push cells below ambient", () => {
    const gale = pvPowerW({ gtiWm2: 900, ambientC: 30, windMs: 40 }, 10, -0.4, 0);
    const atAmbient = pvPowerW({ gtiWm2: 900, ambientC: 30 }, 10, -0.4, 0);
    // Ceiling is the ambient-temperature case (zero rise), approached from below.
    const ceiling = 10 * 900 * (1 - 0.004 * (30 - 25));
    expect(gale).toBeLessThan(ceiling);
    expect(gale).toBeGreaterThan(atAmbient);
  });

  test("wind is monotonically beneficial while cells are above STC", () => {
    const w = [0, 1, 3, 8, 20].map((windMs) =>
      pvPowerW({ gtiWm2: 800, ambientC: 28, windMs }, 10, -0.4, 14),
    );
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThan(w[i - 1] as number);
  });

  test("on a frozen morning wind deepens the cold-cell bonus, bounded by ambient", () => {
    // Wind pulls the cells toward ambient from above — it can only ever *lower*
    // cell temperature, so with a negative coefficient it can only ever help,
    // sub-STC cells included. What bounds the bonus is ambient itself: the
    // cells never reach −10 °C, so the gain stops short of the ambient ceiling.
    const still = pvPowerW({ gtiWm2: 600, ambientC: -10 }, 10, -0.4, 0);
    const windy = pvPowerW({ gtiWm2: 600, ambientC: -10, windMs: 12 }, 10, -0.4, 0);
    const cellsC = -10 + 600 / (25 + 6.84 * 12); // Faiman at 12 m/s: ≈ −4.4 °C
    const ambientCeiling = 10 * 600 * (1 - 0.004 * (-10 - STC_CELL_TEMP_C));

    expect(still).toBeCloseTo(6390, 6); // NOCT cells at +8.75 °C
    expect(windy).toBeCloseTo(10 * 600 * (1 - 0.004 * (cellsC - STC_CELL_TEMP_C)), 6);
    expect(windy).toBeGreaterThan(still);
    expect(windy).toBeLessThan(ambientCeiling);
    expect(still).toBeGreaterThan(10 * 600); // both above nameplate: cells are sub-STC
  });

  test("a negative wind speed cannot invert the cooling denominator into heating", () => {
    // Providers occasionally emit −0.x for calm; a value that drives
    // U0 + U1·v negative would flip the cell-temperature sign.
    const w = pvPowerW({ gtiWm2: 800, ambientC: 20, windMs: -1 }, 10, -0.4, 14);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(10 * 800); // cells still hotter than ambient/STC
  });
});

describe("pvPowerW — real geometry, extreme orientations", () => {
  // Midsummer midday at 48 °N / 15 °E: sun 65° up and within a degree of south.
  const sun = sunPosition(48, 15, Date.parse("2026-06-21T11:00:00Z"));
  const sample = (tilt: number, azimuth: number, at: SunPosition = sun) => ({
    gtiWm2: 700,
    ambientC: 22,
    dniWm2: 850,
    cosAoi: cosAoi(at, tilt, azimuth),
  });

  test("a vertical north wall at noon sees no beam — diffuse only", () => {
    const north = effectiveWm2(sample(90, 180));
    expect(cosAoi(sun, 90, 180)).toBeLessThan(0);
    expect(north).toBeCloseTo(700 * IAM_DIFFUSE, 6);
  });

  test("a flat roof and a south-tilted roof both keep their beam at noon", () => {
    expect(effectiveWm2(sample(0, 0))).toBeGreaterThan(700 * IAM_DIFFUSE);
    expect(effectiveWm2(sample(30, 0))).toBeGreaterThan(700 * IAM_DIFFUSE);
  });

  test("a vertical south facade at high summer noon loses most of its beam", () => {
    // AoI ~25° off grazing: real for balcony arrays, and the case a flat loss
    // percentage silently over-forecasts.
    const facade = effectiveWm2(sample(90, 0));
    expect(facade).toBeLessThan(effectiveWm2(sample(30, 0)));
    expect(facade).toBeGreaterThan(0);
  });

  test("east and west arrays are mirror images under a sun on the meridian", () => {
    // Mirror symmetry is a property of the sun's azimuth, not of the wall
    // clock: it holds exactly when — and only when — the sun is due south.
    const meridian: SunPosition = { ...sun, azimuthDeg: 0 };
    expect(effectiveWm2(sample(35, -90, meridian))).toBeCloseTo(
      effectiveWm2(sample(35, 90, meridian)),
      9,
    );
    expect(effectiveWm2(sample(35, -45, meridian))).toBeCloseTo(
      effectiveWm2(sample(35, 45, meridian)),
      9,
    );
  });

  test("11:00 UTC is not solar noon, so the east array still leads the west", () => {
    // 15 °E puts *mean* solar noon at 11:00 UTC, but late June's equation of
    // time pushes true noon ~1.5 min later — the sun is 0.8° east of south and
    // the model must follow the real sun, not the clock.
    expect(sun.azimuthDeg).toBeLessThan(0);
    expect(sun.azimuthDeg).toBeGreaterThan(-1);
    const east = effectiveWm2(sample(35, -90));
    const west = effectiveWm2(sample(35, 90));
    expect(east).toBeGreaterThan(west);
    expect((east - west) / east).toBeLessThan(0.001); // under a tenth of a percent
  });

  test("azimuth wraps: −180 and +180 describe the same north-facing array", () => {
    expect(effectiveWm2(sample(45, -180))).toBeCloseTo(effectiveWm2(sample(45, 180)), 9);
  });

  test("a sub-horizon winter midnight sun yields diffuse-only, never negative", () => {
    const night = sunPosition(48, 15, Date.parse("2026-12-21T23:00:00Z"));
    const w = pvPowerW(
      { gtiWm2: 0, ambientC: -3, dniWm2: 0, cosAoi: cosAoi(night, 30, 0), windMs: 4 },
      10,
      -0.4,
      14,
    );
    expect(w).toBe(0);
  });
});
