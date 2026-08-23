/**
 * The background jobs that belong to the plant rather than to a device: the PV
 * forecast, the forecast-correction model, and the day-ahead price series.
 *
 * They used to live inside the runtime, which was correct while there was
 * exactly one. With a device per runtime they cannot stay there, and neither
 * obvious fix works: one shared {@link JobScheduler} arms only the first
 * runtime's jobs, because `start` is idempotent while running — which would
 * silently strand every other device's history buffer, since the flush is armed
 * the same way. A scheduler each is worse: N forecast fetches, N correction runs
 * and N price syncs per interval, all doing the same work over the same rows.
 *
 * So the plant's jobs are started once, here, and the runtime keeps only what is
 * genuinely per device: its poll loop and its own buffer's flush.
 *
 * The forecast still has to reach an MQTT bridge, and bridges are per device. So
 * this module does not know about bridges at all — it fetches, and hands the
 * result to an injected {@link PlantJobsDeps.publishForecast}. The composition
 * root points that at one device's bridge, because the forecast is a property of
 * the plant and publishing it twice would have two bridges fighting over the same
 * retained topic.
 */

import { runForecastCorrectionLearn } from "../forecast/forecast-correction-job";
import {
  fetchSolarForecast,
  toForecastExport,
  type ForecastVariant,
  type SolarForecastExport,
} from "../forecast/solar-forecast";
import { runSpotPriceSync } from "../prices/spot-price-job";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import { getWeatherConfig } from "../settings/weather-settings";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";
import { createJobScheduler, type JobScheduler } from "./job-scheduler";
import { publishForecast } from "./runtime";

const logger = log("plant-jobs");

// The PV forecast changes slowly (provider cache is 30 min) and its topics are
// retained, so re-publishing every 5 minutes keeps HA fresh without churn.
const FORECAST_PUBLISH_INTERVAL_MS = 5 * 60_000;

// The correction learns from newly-*settled* reanalysis days, so there is at most
// one new day to fold in per day — twice-daily is ample, with a short post-boot
// kick so a fresh install backfills without waiting a full interval.
const LEARN_INTERVAL_MS = 12 * 3600_000;
const LEARN_KICK_DELAY_MS = 2 * 60_000;

// Day-ahead prices clear around 12:45–13:10 market time, but not reliably — a
// timer aimed at the publication moment would turn a short delay into a day-long
// outage. So poll on a plain interval, which no-ops (one indexed count, zero
// network) once both delivery days are stored; the interval *is* the retry.
const SPOT_INTERVAL_MS = 30 * 60_000;
const SPOT_KICK_DELAY_MS = 30_000;

/** The forecast in both variants, as a bridge publishes it. */
export type ForecastPayload = Record<ForecastVariant, SolarForecastExport>;

export interface PlantJobsDeps {
  /** Defaults to a scheduler arming the process globals. */
  scheduler?: JobScheduler;
  /**
   * Hand the freshly-fetched forecast to whoever publishes it — one device's
   * bridge, chosen by the composition root. `null` means "no forecast", which
   * the publisher uses to clear its retained topics rather than leave a stale
   * one standing.
   */
  publishForecast(forecast: ForecastPayload | null): void;
}

export interface PlantJobs {
  /** Arm the schedules. Idempotent while running, like the scheduler beneath it. */
  start(streams: Streams): void;
  stop(): void;
  /** Fetch and publish now — for a bridge that has just been rebuilt. */
  publishForecastNow(): Promise<void>;
  learnCorrectionNow(): Promise<void>;
  /**
   * Store today's and tomorrow's day-ahead prices (no-op if disabled or already
   * complete). Public so saving the price source refreshes immediately instead
   * of leaving the UI empty until the next tick.
   */
  syncSpotPricesNow(): Promise<void>;
}

// fallow-ignore-next-line unused-export -- the injection seam plant-jobs.test.ts drives against a fake scheduler; test files aren't traced as consumers
export function createPlantJobs(deps: PlantJobsDeps): PlantJobs {
  const scheduler = deps.scheduler ?? createJobScheduler();
  /**
   * The read-side bus, injected by {@link start}. Null until then — the 30 s
   * post-boot price kick can beat the wiring, so the emit is guarded.
   */
  let streams: Streams | null = null;

  async function publishForecastNow(): Promise<void> {
    try {
      const forecast = await fetchSolarForecast(await getWeatherConfig());
      deps.publishForecast(
        forecast
          ? { raw: toForecastExport(forecast, "raw"), usable: toForecastExport(forecast, "usable") }
          : null,
      );
    } catch (error) {
      logger.warn("forecast publish failed: {error}", { error });
    }
  }

  async function learnCorrectionNow(): Promise<void> {
    try {
      await runForecastCorrectionLearn(await getWeatherConfig());
    } catch (error) {
      logger.warn("forecast correction learn failed: {error}", { error });
    }
  }

  async function syncSpotPricesNow(): Promise<void> {
    try {
      const result = await runSpotPriceSync(await getSpotPriceConfig());
      // Only a real upsert changes what price-derived views show; the no-op tick
      // (both delivery days already complete) must not make every open page
      // refetch. A `prices` signal on the statistics topic tells open dashboards
      // their price-derived views are now stale.
      if (result.outcome === "stored") streams?.emit("statistics", { type: "prices" });
    } catch (error) {
      logger.warn("spot price sync failed: {error}", { error });
    }
  }

  return {
    start(streamBus: Streams): void {
      streams = streamBus;
      // Publish once immediately: a freshly-built bridge has empty retained
      // topics, and waiting out the five-minute interval would leave Home
      // Assistant showing no forecast for most of it.
      void publishForecastNow();
      scheduler.start([
        { run: () => void publishForecastNow(), intervalMs: FORECAST_PUBLISH_INTERVAL_MS },
        {
          run: () => void learnCorrectionNow(),
          intervalMs: LEARN_INTERVAL_MS,
          kickMs: LEARN_KICK_DELAY_MS,
        },
        {
          run: () => void syncSpotPricesNow(),
          intervalMs: SPOT_INTERVAL_MS,
          kickMs: SPOT_KICK_DELAY_MS,
        },
      ]);
    },
    stop(): void {
      scheduler.stop();
    },
    publishForecastNow,
    learnCorrectionNow,
    syncSpotPricesNow,
  };
}

/**
 * The plant's own jobs, started once by the composition root.
 *
 * The forecast goes to the default device's bridge. It is a property of the
 * plant, so exactly one bridge may publish it: two would fight over the same
 * retained topic, and the loser's value is whichever arrived last.
 */
const defaultPlantJobs = createPlantJobs({ publishForecast });

export const startPlantJobs = defaultPlantJobs.start;
export const stopPlantJobs = defaultPlantJobs.stop;
export const syncSpotPricesNow = defaultPlantJobs.syncSpotPricesNow;
