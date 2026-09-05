import { describe, expect, test } from "bun:test";
import type {
  ForecastCorrectionCellInsert,
  ForecastCorrectionCellRow,
  ForecastCorrectionStateRow,
} from "@SunReye/db/schema/forecast-correction";
import { weatherConfigSchema } from "@SunReye/db/weather";
import type { InverterProfile, InverterSample } from "@SunReye/inverter-core";
import {
  type CorrectionIo,
  getCorrectionView,
  runForecastCorrectionLearn,
} from "./forecast-correction-job";
import { type IrradianceForecast, buildSolarForecast } from "./solar-forecast";

// The job is driven through its injected IO, so every case below is a real run
// of the real matching + folding code — no module mocks, no database, no clock.

// --- fixtures ---------------------------------------------------------------

/** Frozen "now": 2026-08-15 09:30 UTC. Reanalysis settles 3 days back. */
const NOW = Date.parse("2026-08-15T09:30:00Z");
/** The newest day a run at {@link NOW} may learn from. */
const SETTLED = "2026-08-12";
/** 90 days before {@link SETTLED} — where a first run starts its backfill. */
const BACKFILL_START = "2026-05-14";

const HOUR = 3_600_000;
/** Central European Time / Summer Time, in seconds — the plant's local offsets. */
const CET = 3600;
const CEST = 2 * 3600;

const LOCATION = { latitude: 50.39, longitude: 8.06 };
const INVERTER_ID = "deye-hybrid";
const PV_KEY = "pv.power";

/** A configured plant: weather on, coordinates set, one 10 kWp south array. */
const plant = (forecast: Record<string, unknown> = {}) =>
  weatherConfigSchema.parse({
    enabled: true,
    ...LOCATION,
    forecast: {
      enabled: true,
      arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }],
      tempCoefficient: -0.4,
      systemLoss: 14,
      ...forecast,
    },
  });

/** Minimal profile mapping the total-PV role to a metric key. */
const profileWith = (roles: Array<{ key: string; role: string }>): InverterProfile =>
  ({
    id: INVERTER_ID,
    name: "Hybrid",
    manufacturer: "Deye",
    metrics: roles,
  }) as unknown as InverterProfile;

const pvProfile = profileWith([
  { key: "battery.soc", role: "battery.soc" },
  { key: PV_KEY, role: "pv.total.power" },
]);

/** One hourly archive sample. */
interface HourSample {
  /** Plant-local wall clock, the label Open-Meteo puts on the sample. */
  local: string;
  /** The instant it really happened — what an hourly rollup buckets it under. */
  utcMs: number;
  /** Plane-of-array irradiance, W/m². */
  gti: number;
}

/**
 * One local day of hourly reanalysis: dark outside 09:00–15:00, a flat
 * 600 W/m² inside it, so every full daylight slot carries the same expected
 * power and the shoulder slots (08 and 15) carry half of it.
 * `trueOffset` is the plant's *actual* UTC offset that day — what the measured
 * buckets are keyed by, which is not always what the archive declares.
 */
function day(date: string, trueOffset = CEST): HourSample[] {
  return Array.from({ length: 24 }, (_, h) => {
    const local = `${date}T${String(h).padStart(2, "0")}:00`;
    return {
      local,
      utcMs: Date.parse(`${local}:00Z`) - trueOffset * 1000,
      gti: h >= 9 && h <= 15 ? 600 : 0,
    };
  });
}

/** The samples assembled into the provider payload the PV model consumes. */
const archiveOf = (samples: HourSample[], declaredOffset = CEST): IrradianceForecast => ({
  times: samples.map((s) => s.local),
  utcOffsetSeconds: declaredOffset,
  location: LOCATION,
  temperature: samples.map(() => 20),
  gti: [samples.map((s) => s.gti)],
});

/**
 * Hourly rollups for a plant producing exactly `ratio` × what the model expects
 * from the same weather, keyed by the instant each hour really happened at.
 * The expectation is taken from the same PV model the job runs (proven in
 * `solar-forecast.test.ts`); what is under test here is the pairing and folding.
 */
function measuredOf(
  samples: HourSample[],
  config: ReturnType<typeof plant>,
  ratio: number,
  declaredOffset = CEST,
): Map<number, number> {
  const { series } = buildSolarForecast(
    config.forecast,
    archiveOf(samples, declaredOffset),
    "open-meteo-archive",
  ).raw;
  const rows = new Map<number, number>();
  series.forEach((point, i) => {
    const sample = samples[i];
    if (sample) rows.set(sample.utcMs, point.watts * ratio);
  });
  return rows;
}

/** The model's expected average power for one local slot, W. */
function expectedAt(
  samples: HourSample[],
  config: ReturnType<typeof plant>,
  local: string,
  declaredOffset = CEST,
): number {
  const { series } = buildSolarForecast(
    config.forecast,
    archiveOf(samples, declaredOffset),
    "open-meteo-archive",
  ).raw;
  return series.find((p) => p.time === local)?.watts ?? 0;
}

// --- the harness ------------------------------------------------------------

interface HarnessOptions {
  now?: number;
  profile?: InverterProfile | null;
  sample?: InverterSample | null;
  /** Archive days available upstream; a run only receives those it asks for. */
  samples?: HourSample[];
  /** What Open-Meteo declares as the plant's offset for the whole range. */
  declaredOffset?: number;
  /** Thrown by the archive call instead of returning data. */
  archiveError?: unknown;
  measured?: Map<number, number>;
  cells?: ForecastCorrectionCellRow[];
  state?: ForecastCorrectionStateRow | null;
}

const cellRow = (over: Partial<ForecastCorrectionCellRow> = {}): ForecastCorrectionCellRow => ({
  inverterId: INVERTER_ID,
  month: 8,
  hour: 12,
  ratio: 1,
  weight: 1,
  updatedAt: new Date(NOW),
  ...over,
});

const stateRow = (over: Partial<ForecastCorrectionStateRow> = {}): ForecastCorrectionStateRow => ({
  inverterId: INVERTER_ID,
  learnedThrough: null,
  maeRaw: 0,
  maeCorrected: 0,
  samples: 0,
  updatedAt: new Date(NOW),
  ...over,
});

/** An in-memory plant: persisted grid, measured rollups and a stubbed archive. */
function harness(options: HarnessOptions = {}) {
  const cells = new Map<string, ForecastCorrectionCellRow>();
  for (const row of options.cells ?? [])
    cells.set(`${row.inverterId}:${row.month}:${row.hour}`, row);
  let state = options.state ?? null;
  const declaredOffset = options.declaredOffset ?? CEST;

  const archiveCalls: Array<{
    startDate: string;
    endDate: string;
    planes: Array<{ tilt: number; azimuth: number }>;
    location: { latitude: number; longitude: number };
  }> = [];
  const historyCalls: Array<{ metric: string; inverterId: string; from: number; to: number }> = [];
  const cellWrites: ForecastCorrectionCellInsert[][] = [];

  const io: CorrectionIo = {
    now: () => options.now ?? NOW,
    activeProfile: () => (options.profile === undefined ? pvProfile : options.profile),
    latestSample: () => options.sample ?? null,
    fetchArchive: async (location, planes, startDate, endDate) => {
      archiveCalls.push({ location, planes, startDate, endDate });
      if (options.archiveError !== undefined) throw options.archiveError;
      const inRange = (options.samples ?? []).filter(
        (s) => s.local.slice(0, 10) >= startDate && s.local.slice(0, 10) <= endDate,
      );
      return archiveOf(inRange, declaredOffset);
    },
    measuredHourlyAvg: async (metric, inverterId, from, to) => {
      historyCalls.push({ metric, inverterId, from: from.getTime(), to: to.getTime() });
      return [...(options.measured ?? new Map<number, number>())]
        .filter(([ms]) => ms >= from.getTime() && ms < to.getTime())
        .sort(([a], [b]) => a - b)
        .map(([bucketMs, avg]) => ({ bucketMs, avg }));
    },
    readCells: async (inverterId) => [...cells.values()].filter((c) => c.inverterId === inverterId),
    loadModel: async (inverterId) =>
      new Map(
        [...cells.values()]
          .filter((c) => c.inverterId === inverterId)
          .map((c) => [`${c.month}:${c.hour}`, { ratio: c.ratio, weight: c.weight }]),
      ),
    readState: async (inverterId) => (state?.inverterId === inverterId ? state : null),
    writeCells: async (rows) => {
      cellWrites.push(rows);
      for (const row of rows) {
        cells.set(`${row.inverterId}:${row.month}:${row.hour}`, {
          ...row,
          updatedAt: new Date(NOW),
        });
      }
    },
    writeState: async (next) => {
      state = { ...next, updatedAt: new Date(NOW) };
    },
  };

  return {
    io,
    archiveCalls,
    historyCalls,
    cellWrites,
    cell: (month: number, hour: number, inverterId = INVERTER_ID) =>
      cells.get(`${inverterId}:${month}:${hour}`),
    learnedCells: () => [...cells.values()].sort((a, b) => a.hour - b.hour),
    stored: () => state,
  };
}

// --- the settings view ------------------------------------------------------

describe("forecast correction view", () => {
  test("reports an empty grid when no plant is active", async () => {
    const h = harness({ profile: null });
    const view = await getCorrectionView(plant(), h.io);

    expect(view).toEqual({
      enabled: false,
      learnedThrough: null,
      skill: { maeRaw: 0, maeCorrected: 0, improvementPct: 0, samples: 0 },
      cells: [],
    });
  });

  test("reports an empty grid when the plant measures no total PV power", async () => {
    // A meter-only or battery-only profile has nothing to compare a forecast to.
    const h = harness({ profile: profileWith([{ key: "battery.soc", role: "battery.soc" }]) });

    expect(await getCorrectionView(plant(), h.io)).toMatchObject({
      cells: [],
      learnedThrough: null,
    });
  });

  test("mirrors the apply toggle whether or not anything has been learned", async () => {
    const on = plant({ correction: { enabled: true } });
    expect((await getCorrectionView(on, harness({ profile: null }).io)).enabled).toBe(true);
    expect((await getCorrectionView(on, harness().io)).enabled).toBe(true);
    expect((await getCorrectionView(plant(), harness().io)).enabled).toBe(false);
  });

  test("shrinks a barely-observed cell toward 1 and clamps a wild one", async () => {
    const h = harness({
      cells: [
        cellRow({ hour: 10, ratio: 2, weight: 1 }),
        cellRow({ hour: 11, ratio: 5, weight: 400 }),
        cellRow({ hour: 12, ratio: 0.05, weight: 400 }),
      ],
    });

    const { cells } = await getCorrectionView(plant(), h.io);
    const factor = (hour: number) => cells.find((c) => c.hour === hour)?.factor;

    // One observation of "twice the model" moves the applied factor by 1/6th.
    expect(factor(10)).toBeCloseTo(1 + 1 * (1 / 6), 6);
    // A confident cell is still a nudge, never an override: ±40 % is the wall.
    expect(factor(11)).toBe(1.4);
    expect(factor(12)).toBe(0.6);
  });

  test("reports the measured improvement over the uncorrected forecast", async () => {
    const h = harness({
      state: stateRow({
        learnedThrough: "2026-08-09",
        maeRaw: 400,
        maeCorrected: 300,
        samples: 90,
      }),
      cells: [cellRow({ hour: 13, ratio: 1.2, weight: 30 })],
    });

    const view = await getCorrectionView(plant(), h.io);

    expect(view.learnedThrough).toBe("2026-08-09");
    expect(view.skill.improvementPct).toBeCloseTo(25, 6);
    expect(view.cells).toHaveLength(1);
    expect(view.cells[0]?.weight).toBe(30);
  });

  test("reads the grid under the inverter id the live sample carries", async () => {
    // The serial-numbered id from the poll wins over the profile slug, so the
    // grid stays attached to the plant that produced the data.
    const h = harness({
      sample: { time: "2026-08-15T09:00:00Z", inverterId: "sn-4711", metrics: {} },
      cells: [
        cellRow({ inverterId: "sn-4711", hour: 12, ratio: 1.3, weight: 20 }),
        cellRow({ inverterId: INVERTER_ID, hour: 12, ratio: 0.5, weight: 20 }),
      ],
    });

    const { cells } = await getCorrectionView(plant(), h.io);

    expect(cells).toHaveLength(1);
    expect(cells[0]?.factor).toBeGreaterThan(1);
  });
});

// --- runs that must not touch anything --------------------------------------

describe("correction learn run — when there is nothing to do", () => {
  test("stays out of the way until the forecast is configured", async () => {
    for (const config of [
      weatherConfigSchema.parse({}),
      plant({ enabled: false }),
      plant({ arrays: [] }),
    ]) {
      const h = harness({ samples: day(SETTLED) });
      expect(await runForecastCorrectionLearn(config, h.io)).toEqual({
        learned: 0,
        learnedThrough: null,
      });
      expect(h.archiveCalls).toHaveLength(0);
    }
  });

  test("the runtime's one-argument call no-ops on an unconfigured forecast", async () => {
    // `runtime.ts` calls this with the config alone. This pins that call shape and
    // the no-op it must return — it does NOT prove what the default wiring is:
    // `forecastReady` rejects the config before the IO is ever dereferenced, so
    // the assertion below would hold for any default. Proving the production
    // wiring would mean letting the real `getActiveProfileOrNull`/`liveState`
    // answer, and those are module state a sibling suite mocks process-globally
    // (`solar-forecast.test.ts`) — the result would turn on test file order.
    expect(await runForecastCorrectionLearn(weatherConfigSchema.parse({}))).toEqual({
      learned: 0,
      learnedThrough: null,
    });
  });

  test("stays out of the way until a plant measures total PV power", async () => {
    for (const profile of [null, profileWith([{ key: "battery.soc", role: "battery.soc" }])]) {
      const h = harness({ profile, samples: day(SETTLED) });
      expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
        learned: 0,
        learnedThrough: null,
      });
      expect(h.archiveCalls).toHaveLength(0);
    }
  });

  test("does not reach for days that have not settled yet", async () => {
    // The cursor is already on the newest settled day: nothing is due, and the
    // next two days must not be fetched — reanalysis has not stabilised.
    const h = harness({
      state: stateRow({ learnedThrough: SETTLED }),
      samples: day(SETTLED),
    });

    expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
      learned: 0,
      learnedThrough: SETTLED,
    });
    expect(h.archiveCalls).toHaveLength(0);
  });

  test("a cursor ahead of the settled window parks the job instead of looping", async () => {
    // Restored backup, or a clock that jumped: never fetch a negative window.
    const h = harness({ state: stateRow({ learnedThrough: "2026-09-30" }) });

    expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
      learned: 0,
      learnedThrough: "2026-09-30",
    });
    expect(h.archiveCalls).toHaveLength(0);
  });

  test("keeps the cursor when the archive call fails, so the days are retried", async () => {
    for (const failure of [new Error("504 upstream"), "socket hang up"]) {
      const h = harness({
        state: stateRow({ learnedThrough: "2026-08-09" }),
        archiveError: failure,
      });

      expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
        learned: 0,
        learnedThrough: "2026-08-09",
      });
      expect(h.archiveCalls).toHaveLength(1);
      expect(h.stored()?.learnedThrough).toBe("2026-08-09");
      expect(h.cellWrites).toHaveLength(0);
    }
  });

  test("keeps the cursor when the archive answers with no hours at all", async () => {
    const h = harness({ state: stateRow({ learnedThrough: "2026-08-09" }), samples: [] });

    expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
      learned: 0,
      learnedThrough: "2026-08-09",
    });
    // Nothing to line up against, so the rollups are never queried.
    expect(h.historyCalls).toHaveLength(0);
    expect(h.cellWrites).toHaveLength(0);
  });

  test("keeps the cursor when no measured hour overlaps the window", async () => {
    // Fresh install, rollup lag, inverter offline: consuming the days here would
    // burn them with nothing learned.
    const h = harness({ samples: day(SETTLED), measured: new Map() });

    expect(await runForecastCorrectionLearn(plant(), h.io)).toEqual({
      learned: 0,
      learnedThrough: null,
    });
    expect(h.historyCalls).toHaveLength(1);
    expect(h.cellWrites).toHaveLength(0);
    expect(h.stored()).toBeNull();
  });
});

// --- the window a run asks for ----------------------------------------------

describe("correction learn run — the window it asks for", () => {
  test("the first run backfills 90 days, ending three days back", async () => {
    const h = harness();
    await runForecastCorrectionLearn(plant(), h.io);

    expect(h.archiveCalls[0]).toMatchObject({
      startDate: BACKFILL_START,
      endDate: SETTLED,
      location: LOCATION,
    });
  });

  test("later runs resume the day after the cursor", async () => {
    const h = harness({ state: stateRow({ learnedThrough: "2026-08-09" }) });
    await runForecastCorrectionLearn(plant(), h.io);

    expect(h.archiveCalls[0]).toMatchObject({ startDate: "2026-08-10", endDate: SETTLED });
  });

  test("crossing a month boundary rolls the date, not the day number", async () => {
    const h = harness({ state: stateRow({ learnedThrough: "2026-07-31" }) });
    await runForecastCorrectionLearn(plant(), h.io);

    expect(h.archiveCalls[0]?.startDate).toBe("2026-08-01");
  });

  test("asks for one plane per configured array, orientation only", async () => {
    const eastWest = plant({
      arrays: [
        { kwp: 6, tilt: 30, azimuth: -90 },
        { kwp: 4, tilt: 15, azimuth: 90 },
      ],
    });
    const h = harness();
    await runForecastCorrectionLearn(eastWest, h.io);

    // The array's size is the PV model's business, not the irradiance provider's.
    expect(h.archiveCalls[0]?.planes).toEqual([
      { tilt: 30, azimuth: -90 },
      { tilt: 15, azimuth: 90 },
    ]);
  });

  test("queries the rollups over exactly the forecast's span, for the PV metric", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, plant(), 1) });
    await runForecastCorrectionLearn(plant(), h.io);

    const first = samples[0];
    const last = samples.at(-1);
    expect(h.historyCalls[0]).toEqual({
      metric: PV_KEY,
      inverterId: INVERTER_ID,
      from: first?.utcMs ?? 0,
      // The last slot is included whole — a rollup bucket opens at its start.
      to: (last?.utcMs ?? 0) + HOUR,
    });
  });
});

// --- what a run folds -------------------------------------------------------

describe("correction learn run — what it folds", () => {
  const config = plant();

  test("learns a site that steadily out-produces the model", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });

    const result = await runForecastCorrectionLearn(config, h.io);

    // Every hour of the day lines up (a dark hour measures 0, which is data);
    // only the ones with real irradiance carry site signal.
    expect(result).toEqual({ learned: 24, learnedThrough: SETTLED });
    expect(h.learnedCells().map((c) => c.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    for (const cell of h.learnedCells()) {
      expect(cell.month).toBe(8);
      expect(cell.inverterId).toBe(INVERTER_ID);
      expect(cell.ratio).toBeCloseTo(1.2, 6);
      // One observation each — the applied factor is still mostly shrunk away.
      expect(cell.weight).toBe(1);
    }
  });

  test("night hours are matched but never learned from", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });
    await runForecastCorrectionLearn(config, h.io);

    // Dawn/dusk ratios explode near zero and carry no site signal.
    expect(h.cell(8, 3)).toBeUndefined();
    expect(h.cell(8, 20)).toBeUndefined();
    // Eight learnable hours, weighing a shade under eight: the skill mean decays
    // with every observation it folds, including the ones inside this batch.
    // `samples` is an EWMA weight, `w ← w·d + 1`, so eight folds from zero sum
    // the geometric series (1 − d⁸)/(1 − d) rather than reaching a flat 8.
    // The half life is restated here on purpose — importing the source's
    // constant would make this agree with any retuning instead of catching it.
    const decay = 2 ** (-1 / 30); // HALF_LIFE_OBS, forecast-correction.ts
    const eightFolds = (1 - decay ** 8) / (1 - decay);
    expect(eightFolds).toBeLessThan(8);
    expect(h.stored()?.samples).toBeCloseTo(eightFolds, 10);
  });

  test("the first batch can show no improvement — it had no correction to apply", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });
    await runForecastCorrectionLearn(config, h.io);

    const skill = h.stored();
    expect(skill?.maeRaw).toBeGreaterThan(0);
    // Skill is measured out of sample: each hour is scored with the factor as it
    // stood *before* that hour updated the cell, which on a virgin grid is 1.
    expect(skill?.maeCorrected).toBeCloseTo(skill?.maeRaw ?? 0, 6);
  });

  test("a second day is scored against what the first day taught", async () => {
    const first = day("2026-08-11");
    const second = day(SETTLED);
    const both = [...first, ...second];
    const h = harness({ samples: both, measured: measuredOf(both, config, 1.2) });

    await runForecastCorrectionLearn(config, h.io);

    expect(h.stored()?.learnedThrough).toBe(SETTLED);
    expect(h.cell(8, 12)?.weight).toBeGreaterThan(1.9);
    expect(h.cell(8, 12)?.ratio).toBeCloseTo(1.2, 6);
    // The second day's hours were predicted with the first day's factor, which
    // already leaned the right way.
    const skill = h.stored();
    expect(skill?.maeCorrected).toBeLessThan(skill?.maeRaw ?? 0);
  });

  test("a zero-production hour is a reading, not a gap", async () => {
    // Snow on the panels, or a tripped string: the plant made nothing while the
    // model expected plenty. That is exactly the bias worth learning, floored so
    // one bad day cannot drive a cell to zero.
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 0) });

    await runForecastCorrectionLearn(config, h.io);

    expect(h.cell(8, 12)?.ratio).toBeCloseTo(0.2, 6);
    expect(h.learnedCells()).toHaveLength(8);
  });

  test("a negative measured average is a glitch and is dropped", async () => {
    const samples = day(SETTLED);
    const measured = new Map([...measuredOf(samples, config, 1.2)].map(([ms]) => [ms, -50]));
    const h = harness({ samples, measured });

    const result = await runForecastCorrectionLearn(config, h.io);

    expect(h.learnedCells()).toHaveLength(0);
    // `learned` counts the hours that were *matched*, not the ones that survived
    // the filters — a run can report 24 and have taught the grid nothing.
    expect(result.learned).toBe(24);
    // The days are still settled, so the cursor moves on rather than sticking.
    expect(h.stored()?.learnedThrough).toBe(SETTLED);
    expect(h.cellWrites).toEqual([[]]);
  });

  test("hours pinned to the feed-in cap are dropped as curtailed", async () => {
    // Above the cap the plant, not the model, decides the output — learning
    // there would record clipping as model over-prediction.
    //
    // This is also why no test here can pin the job's use of the *uncurtailed*
    // `raw` view: `learn`'s curtailment ceiling is `min(nameplate × 0.85, cap)`,
    // which is never above the cap, while clipping only rewrites slots above the
    // cap. Every slot the two views disagree on is one `learn` already drops, so
    // the usable view would produce an identical grid. `raw` stays the documented
    // choice on its own merits (it is the quantity the model predicts), not
    // because a fixture can tell the difference.
    const capped = plant({ maxOutputW: 3000 });
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, capped, 1.2) });

    await runForecastCorrectionLearn(capped, h.io);

    // Only the shoulder slots stay below the cap on both sides of the pair.
    expect(h.learnedCells().map((c) => c.hour)).toEqual([8, 15]);
  });

  test("hours too dim to matter never reach the grid", async () => {
    const overcast = day(SETTLED).map((s) => ({ ...s, gti: s.gti > 0 ? 20 : 0 }));
    const h = harness({ samples: overcast, measured: measuredOf(overcast, config, 1.2) });

    const result = await runForecastCorrectionLearn(config, h.io);

    // 20 W/m² on 10 kWp is under the 3 %-of-nameplate floor.
    expect(result.learned).toBe(24);
    expect(h.learnedCells()).toHaveLength(0);
    expect(h.stored()?.learnedThrough).toBe(SETTLED);
  });

  test("persists one row per touched cell, with the grid's own values", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });
    await runForecastCorrectionLearn(config, h.io);

    expect(h.cellWrites).toHaveLength(1);
    expect(h.cellWrites[0]).toHaveLength(8);
    expect(h.cellWrites[0]?.[0]).toMatchObject({ inverterId: INVERTER_ID, month: 8 });
  });

  test("keys the grid to the live sample's inverter, not the profile slug", async () => {
    const samples = day(SETTLED);
    const h = harness({
      sample: { time: "2026-08-15T09:00:00Z", inverterId: "sn-4711", metrics: {} },
      samples,
      measured: measuredOf(samples, config, 1.2),
    });

    await runForecastCorrectionLearn(config, h.io);

    expect(h.historyCalls[0]?.inverterId).toBe("sn-4711");
    expect(h.cell(8, 12, "sn-4711")).toBeDefined();
    expect(h.stored()?.inverterId).toBe("sn-4711");
  });
});

// --- cursor movement across runs --------------------------------------------

describe("correction learn run — the cursor across runs", () => {
  const config = plant();

  test("stops at the last day that actually had measured hours", async () => {
    // The inverter went offline on the 12th; the rollups end on the 11th.
    const days = [...day("2026-08-10"), ...day("2026-08-11"), ...day(SETTLED)];
    const measured = measuredOf(days, config, 1.2);
    for (const s of days.filter((d) => d.local.startsWith(SETTLED))) measured.delete(s.utcMs);
    const h = harness({ samples: days, measured });

    const result = await runForecastCorrectionLearn(config, h.io);

    expect(result.learnedThrough).toBe("2026-08-11");
    expect(h.stored()?.learnedThrough).toBe("2026-08-11");

    // The missing day is asked for again on the next run rather than skipped.
    h.archiveCalls.length = 0;
    await runForecastCorrectionLearn(config, h.io);
    expect(h.archiveCalls[0]).toMatchObject({ startDate: SETTLED, endDate: SETTLED });
  });

  test("re-running a settled window folds nothing a second time", async () => {
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });

    const first = await runForecastCorrectionLearn(config, h.io);
    const before = { ...h.cell(8, 12) };
    const second = await runForecastCorrectionLearn(config, h.io);

    expect(first.learned).toBe(24);
    expect(second).toEqual({ learned: 0, learnedThrough: SETTLED });
    // Same weight, same ratio: the hours were not counted twice.
    expect(h.cell(8, 12)).toEqual(before as ForecastCorrectionCellRow);
    expect(h.cellWrites).toHaveLength(1);
  });

  test("two overlapping runs must not count the same hours twice", async () => {
    // The runtime kicks the job on a timer and again after settings change; the
    // job holds no lock, so both may be in flight over the same window.
    const samples = day(SETTLED);
    const h = harness({ samples, measured: measuredOf(samples, config, 1.2) });

    const [a, b] = await Promise.all([
      runForecastCorrectionLearn(config, h.io),
      runForecastCorrectionLearn(config, h.io),
    ]);

    expect(a).toEqual(b);
    expect(h.cell(8, 12)?.weight).toBe(1);
    expect(h.stored()?.learnedThrough).toBe(SETTLED);
  });
});

// --- clocks and calendars ---------------------------------------------------

describe("correction learn run — clocks and calendars", () => {
  const config = plant();

  test("a plant-local evening hour is learned into its local month and hour", async () => {
    // 22:00 local on the last day of August is 20:00 UTC — the cell must follow
    // the plant's wall clock, not the instant's.
    const samples = day("2026-08-31").map((s) => ({ ...s, gti: 600 }));
    const h = harness({
      now: Date.parse("2026-09-03T04:00:00Z"),
      state: stateRow({ learnedThrough: "2026-08-30" }),
      samples,
      measured: measuredOf(samples, config, 1.2),
    });

    await runForecastCorrectionLearn(config, h.io);

    expect(h.cell(8, 22)).toBeDefined();
    expect(h.cell(9, 22)).toBeUndefined();
    expect(h.stored()?.learnedThrough).toBe("2026-08-31");
  });

  test("an hour before a DST change is folded into the neighbouring cell", async () => {
    // KNOWN LIMITATION. Open-Meteo returns *one* `utc_offset_seconds` for the
    // whole range — the offset in force when the request is made — while the
    // local timestamps inside the range honour the DST change. A backfill that
    // reaches back over the March switch therefore converts pre-switch local
    // hours with the summer offset and lands one hour early in the rollups.
    // The fingerprint below is what that costs: the 15:00 cell records 2.4 (it
    // was paired with the measurement of 14:00, an hour twice as bright) and
    // the 08:00 cell records the 0.2 floor (paired with dark 07:00), on a plant
    // that produced exactly 1.2 × the model all day.
    const samples = day("2026-03-27", CET);
    const h = harness({
      now: Date.parse("2026-04-02T06:00:00Z"),
      state: stateRow({ learnedThrough: "2026-03-26" }),
      samples,
      declaredOffset: CEST,
      measured: measuredOf(samples, config, 1.2, CEST),
    });

    await runForecastCorrectionLearn(config, h.io);

    expect(h.cell(3, 15)?.ratio).toBeCloseTo(2.4, 6);
    expect(h.cell(3, 8)?.ratio).toBeCloseTo(0.2, 6);
    for (const hour of [10, 11, 12, 13, 14]) {
      expect(h.cell(3, hour)?.ratio).toBeCloseTo(1.2, 6);
    }
    // The 15:00 cell was handed the 14:00 hour's measurement, which is exactly
    // twice the power the 15:00 shoulder slot expects.
    const shoulder = expectedAt(samples, config, "2026-03-27T15:00", CEST);
    const middaySlot = expectedAt(samples, config, "2026-03-27T14:00", CEST);
    expect(middaySlot).toBeCloseTo(shoulder * 2, 6);
  });

  test("a plant on a half-hour offset never lines up with an hourly rollup", async () => {
    // KNOWN LIMITATION. Rollup buckets open on the UTC hour; a +05:30 plant's
    // local hours open at :30 past it, so no forecast slot ever finds a
    // measurement. The run keeps its cursor — correctly, since nothing was
    // learned — and asks for the same 90 days again, every day, forever.
    const IST = 5.5 * 3600;
    const samples = day(SETTLED, IST);
    const h = harness({
      samples,
      declaredOffset: IST,
      // The rollups the database can actually hold: on the UTC hour.
      measured: new Map(
        [...measuredOf(samples, config, 1.2, IST)].map(([ms, avg]) => [
          Math.floor(ms / HOUR) * HOUR,
          avg,
        ]),
      ),
    });

    expect(await runForecastCorrectionLearn(config, h.io)).toEqual({
      learned: 0,
      learnedThrough: null,
    });

    await runForecastCorrectionLearn(config, h.io);
    expect(h.archiveCalls.map((c) => c.startDate)).toEqual([BACKFILL_START, BACKFILL_START]);
  });

  test("settles days by date, so a run just after midnight moves the window on", async () => {
    const before = harness({ now: Date.parse("2026-08-15T23:59:00Z") });
    const after = harness({ now: Date.parse("2026-08-16T00:01:00Z") });
    await runForecastCorrectionLearn(config, before.io);
    await runForecastCorrectionLearn(config, after.io);

    expect(before.archiveCalls[0]?.endDate).toBe("2026-08-12");
    expect(after.archiveCalls[0]?.endDate).toBe("2026-08-13");
  });
});
