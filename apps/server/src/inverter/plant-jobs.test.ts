import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { ForecastVariant, SolarForecastExport } from "../forecast/solar-forecast";

// The three jobs reach the outside world through four modules. Each is spread and
// handed back by value in `afterAll`, because `mock.module` is process-global and
// permanent: a partial mock deletes the other exports for every file that runs
// afterwards, and a namespace is live, so only a by-value snapshot restores.
const realWeather = await import("../settings/weather-settings");
const realForecast = await import("../forecast/solar-forecast");
const realLearn = await import("../forecast/forecast-correction-job");
const realSpotSettings = await import("../settings/spot-price-settings");
const realSpotJob = await import("../prices/spot-price-job");

const realWeatherExports = { ...realWeather };
const realForecastExports = { ...realForecast };
const realLearnExports = { ...realLearn };
const realSpotSettingsExports = { ...realSpotSettings };
const realSpotJobExports = { ...realSpotJob };

const WEATHER_CONFIG = { enabled: true } as unknown as Awaited<
  ReturnType<typeof realWeather.getWeatherConfig>
>;

/** What the doubles do this test; reset in `beforeEach`. */
let weatherSeenBy: string[] = [];
let forecastResult: unknown = null;
let forecastError: string | null = null;
let learnRuns = 0;
let learnError: string | null = null;
let spotRuns = 0;
let spotOutcome: "stored" | "complete" = "complete";
let spotError: string | null = null;

mock.module("../settings/weather-settings", () => ({
  ...realWeather,
  getWeatherConfig: async () => WEATHER_CONFIG,
}));
mock.module("../forecast/solar-forecast", () => ({
  ...realForecast,
  fetchSolarForecast: async (config: unknown) => {
    weatherSeenBy.push("forecast");
    expect(config).toBe(WEATHER_CONFIG);
    if (forecastError) throw new Error(forecastError);
    return forecastResult;
  },
  toForecastExport: (_forecast: unknown, variant: ForecastVariant) =>
    ({ todayKwh: variant === "raw" ? 10 : 8 }) as unknown as SolarForecastExport,
}));
mock.module("../forecast/forecast-correction-job", () => ({
  ...realLearn,
  runForecastCorrectionLearn: async () => {
    weatherSeenBy.push("learn");
    learnRuns++;
    if (learnError) throw new Error(learnError);
  },
}));
mock.module("../settings/spot-price-settings", () => ({
  ...realSpotSettings,
  getSpotPriceConfig: async () => ({ enabled: true }),
}));
mock.module("../prices/spot-price-job", () => ({
  ...realSpotJob,
  runSpotPriceSync: async () => {
    spotRuns++;
    if (spotError) throw new Error(spotError);
    return { outcome: spotOutcome, stored: spotOutcome === "stored" ? 96 : 0 };
  },
}));

afterAll(() => {
  mock.module("../settings/weather-settings", () => ({ ...realWeatherExports }));
  mock.module("../forecast/solar-forecast", () => ({ ...realForecastExports }));
  mock.module("../forecast/forecast-correction-job", () => ({ ...realLearnExports }));
  mock.module("../settings/spot-price-settings", () => ({ ...realSpotSettingsExports }));
  mock.module("../prices/spot-price-job", () => ({ ...realSpotJobExports }));
});

const { createPlantJobs } = await import("./plant-jobs");
const { createStreams } = await import("../shared/streams");

/** A scheduler double: records what was armed and lets a test fire it by hand. */
function fakeScheduler() {
  const jobs: { run: () => void; intervalMs: number; kickMs?: number }[] = [];
  let starts = 0;
  let stops = 0;
  return {
    jobs,
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
    scheduler: {
      start(next: typeof jobs) {
        starts++;
        // The real one is idempotent while running; so is this.
        if (jobs.length === 0) jobs.push(...next);
      },
      stop() {
        stops++;
        jobs.length = 0;
      },
    },
  };
}

/** Let every pending microtask (and any 0 ms timer) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Fire the job armed at `intervalMs` and let its async body settle. */
async function fire(jobs: { run: () => void; intervalMs: number }[], intervalMs: number) {
  const job = jobs.find((j) => j.intervalMs === intervalMs);
  if (!job) throw new Error(`no job armed at ${intervalMs}ms`);
  job.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function build(over: { publishForecast?: (f: unknown) => void } = {}) {
  const published: unknown[] = [];
  const sched = fakeScheduler();
  const jobs = createPlantJobs({
    scheduler: sched.scheduler,
    publishForecast: over.publishForecast ?? ((f) => published.push(f)),
  });
  return { jobs, published, sched };
}

beforeEach(() => {
  weatherSeenBy = [];
  forecastResult = { some: "forecast" };
  forecastError = null;
  learnRuns = 0;
  learnError = null;
  spotRuns = 0;
  spotOutcome = "complete";
  spotError = null;
});

// These three jobs are properties of the plant, not of a device: one PV forecast,
// one correction model, one day-ahead price series. Left inside the per-device
// runtime, two devices would fetch the forecast twice, learn the same correction
// twice and sync the same prices twice, every interval, forever.
describe("what the plant schedules", () => {
  test("arms the forecast, learn and price jobs, with the two post-boot kicks", () => {
    const { jobs, sched } = build();

    jobs.start(createStreams());

    expect(sched.jobs).toHaveLength(3);
    expect(sched.jobs.filter((j) => j.kickMs !== undefined)).toHaveLength(2);
  });

  test("arms no history flush — that belongs to the device that buffers rows", () => {
    // Each runtime owns its own buffer, so the flush cannot be hoisted: one
    // shared flush would strand every other device's rows in memory.
    const { jobs, sched } = build();

    jobs.start(createStreams());

    expect(sched.jobs.map((j) => j.intervalMs)).not.toContain(1000);
  });

  test("publishes the forecast immediately, not five minutes from now", async () => {
    // A bridge built at boot has empty retained topics; waiting out the interval
    // would leave Home Assistant showing no forecast for most of it.
    const { jobs, published } = build();

    jobs.start(createStreams());
    await settle();

    expect(published).toHaveLength(1);
  });

  test("starting twice arms nothing new", () => {
    const { jobs, sched } = build();
    const streams = createStreams();

    jobs.start(streams);
    jobs.start(streams);

    expect(sched.jobs).toHaveLength(3);
  });

  test("stopping clears the schedule", () => {
    const { jobs, sched } = build();
    jobs.start(createStreams());

    jobs.stop();

    expect(sched.stops).toBe(1);
  });
});

describe("the forecast", () => {
  test("is fetched and handed to whoever publishes it", async () => {
    const { jobs, published, sched } = build();
    jobs.start(createStreams());
    await settle(); // let the publish that start() does immediately land
    published.length = 0;

    await fire(sched.jobs, 5 * 60_000);

    expect(published).toEqual([{ raw: { todayKwh: 10 }, usable: { todayKwh: 8 } }]);
  });

  test("a disabled forecast publishes null rather than nothing", async () => {
    // The publisher clears its retained topics on null; skipping the call would
    // leave a stale forecast in Home Assistant forever.
    forecastResult = null;
    const { jobs, published, sched } = build();
    jobs.start(createStreams());
    await settle();
    published.length = 0;

    await fire(sched.jobs, 5 * 60_000);

    expect(published).toEqual([null]);
  });

  test("a failing fetch is logged, never thrown into the timer", async () => {
    forecastError = "provider unreachable";
    const { jobs, published, sched } = build();
    jobs.start(createStreams());
    await settle();
    published.length = 0;

    await fire(sched.jobs, 5 * 60_000);

    expect(published).toEqual([]);
  });

  test("can be published on demand, for a bridge that has just been rebuilt", async () => {
    const { jobs, published } = build();

    await jobs.publishForecastNow();

    expect(published).toHaveLength(1);
  });
});

describe("the correction and the prices", () => {
  test("the correction is kicked after boot and runs on its interval", async () => {
    const { jobs, sched } = build();
    jobs.start(createStreams());

    await fire(sched.jobs, 12 * 3600_000);

    expect(learnRuns).toBe(1);
    expect(weatherSeenBy).toContain("learn");
  });

  test("a failing correction run is swallowed and logged", async () => {
    learnError = "reanalysis archive unavailable";
    const { jobs, sched } = build();
    jobs.start(createStreams());

    await fire(sched.jobs, 12 * 3600_000);

    expect(learnRuns).toBe(1);
  });

  test("only a sync that stored slots wakes the open dashboards", async () => {
    // The no-op tick — both delivery days already complete — must not make every
    // open page refetch.
    const { jobs } = build();
    const streams = createStreams();
    let signals = 0;
    streams.subscribe("statistics", () => {
      signals++;
    });
    jobs.start(streams);

    spotOutcome = "complete";
    await jobs.syncSpotPricesNow();
    expect(signals).toBe(0);

    spotOutcome = "stored";
    await jobs.syncSpotPricesNow();
    expect(signals).toBe(1);
  });

  test("a failing price sync is swallowed and signals nothing", async () => {
    spotError = "ENTSO-E rejected the token";
    const { jobs } = build();
    const streams = createStreams();
    let signals = 0;
    streams.subscribe("statistics", () => {
      signals++;
    });
    jobs.start(streams);

    await jobs.syncSpotPricesNow();

    expect(signals).toBe(0);
    expect(spotRuns).toBe(1);
  });

  test("a sync before the bus is wired does not throw", async () => {
    // The post-boot kick can beat the composition root's `start`.
    const { jobs } = build();
    spotOutcome = "stored";

    await jobs.syncSpotPricesNow();

    expect(spotRuns).toBe(1);
  });
});
