/// <reference types="bun" />
// How the dashboard keeps today current: what it reads again as the minute, the quarter, the hour
// and the day move on.
import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { connect } from "../api/core.ts";
import { eachSeries, tally } from "../api/core.harness.ts";
import type { Visibility } from "../api/live.ts";
import type { Day } from "./day.ts";
import { followDay } from "./day-follow.ts";

const PLANT = "4294967294";
const SPOT = "4294967292";
const WEATHER = "4294967295";
const MINUTE = 60_000;

const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    {
      id: 1,
      name: "Süd",
      optimized: 0,
      device: 1,
      input: 1,
      azimuth: 0,
      tilt: 30,
      loss: 0,
      moduleType: 1,
      modules: 10,
    },
  ],
  warnings: [],
};

const SKY = [{ issued: "2026-11-12T00:00:00Z", target: "2026-11-12T00:00:00Z", value: 3 }];

/** A page whose visibility the test flips. */
class Page extends EventTarget {
  hidden = false;

  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

/** A range read of the plant's day: `made` Wh of PV so far, and the weather device's sky. */
function range(href: string, made: number): Response {
  const path = new URL(href).pathname;

  if (path.endsWith("/statistics"))
    return eachSeries(href, (series) => ({
      period: "day",
      points: [{ date: "", start: "", end: "", integral: series === "pv.power" ? made : 0 }],
    }));

  // The weather device forecasts the sky; nothing else is stored.
  const weather = path.endsWith(`/devices/${WEATHER}/forecasts`);

  return eachSeries(href, (series) => ({
    points: weather && series === "weather.code" ? SKY : [],
  }));
}

/** A plant in UTC that made `made` Wh so far today, and every request asked of it. */
function plant(page: Visibility) {
  const urls: string[] = [];
  const state = { made: 1000 };

  const core = connect(
    {
      base: "http://core.test/",
      fetch: (request) => {
        const url = new URL(request.url);
        const path = url.pathname;

        urls.push(request.url);

        if (path.endsWith("/timezone")) return Promise.resolve(Response.json({ name: "UTC" }));

        if (path.endsWith("/layout")) return Promise.resolve(Response.json(LAYOUT));

        return Promise.resolve(range(request.url, state.made));
      },
    },
    page,
  );

  return {
    core,
    state,
    /** The requests since the last call, by path. */
    since: () => tally(urls.splice(0)),
  };
}

async function drain(rounds = 200): Promise<void> {
  if (rounds === 0) return;

  await Promise.resolve();
  await drain(rounds - 1);
}

/** Moves the clock on by `ms` and lets the reads it starts land. */
async function pass(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await drain();
}

/** Moves the clock on `count` minutes, one at a time. */
async function minutes(count: number): Promise<void> {
  if (count === 0) return;

  await pass(MINUTE);
  await minutes(count - 1);
}

/** Today's six energies, in one read, and money: they move every minute. */
const MOVING = { [`devices/${PLANT}/statistics`]: 1, costs: 1 };

/** The day chart's two measured powers and the weather now, each one read: they move each
 * quarter. */
const QUARTERLY = {
  ...MOVING,
  [`devices/${PLANT}/history`]: 1,
  [`devices/${WEATHER}/history`]: 1,
  [`devices/${WEATHER}/forecasts`]: 1,
};

/** The forecasts: they move each hour. */
const FORECASTS = { [`devices/1/forecasts`]: 1, [`devices/${SPOT}/forecasts`]: 1 };

const HOURLY = { ...QUARTERLY, ...FORECASTS };

/** Which day today is, and the inverters forecast: read with today whole. */
const PLACE = { timezone: 1, layout: 1 };

const FULL = { ...HOURLY, ...PLACE };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-11-12T10:01:30Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

test("today is read once, then each minute only its energies and money", async () => {
  const page = new Page();
  const { core, state, since } = plant(page);
  const days: Day[] = [];

  const stop = followDay(
    core,
    (day) => {
      days.push(day);
    },
    page,
  );

  await drain();
  expect(since()).toEqual(FULL);
  expect(days.at(-1)?.today.production).toBe(1);

  state.made = 1500;
  await pass(MINUTE);

  expect(since()).toEqual(MOVING);
  expect(days.at(-1)?.today.production).toBe(1.5);
  expect(days.at(-1)?.now.toISOString()).toBe("2026-11-12T10:02:30.000Z");
  stop();
});

test("a quarter's close reads the chart and the weather again, an hour's the forecasts", async () => {
  const page = new Page();
  const { core, since } = plant(page);
  const stop = followDay(core, () => {}, page);

  await drain();
  since();

  // 10:02:30 to 10:15:30: the minutes alone. The core closes a quarter a minute after its end.
  await minutes(14);

  expect(since()).toEqual({ [`devices/${PLANT}/statistics`]: 14, costs: 14 });

  // 10:16:30.
  await pass(MINUTE);
  expect(since()).toEqual(QUARTERLY);

  // On to 11:00:30, then 11:01:30.
  await minutes(44);

  since();
  await pass(MINUTE);
  expect(since()).toEqual(HOURLY);
  stop();
});

test("a new day is read whole", async () => {
  setSystemTime(new Date("2026-11-12T23:59:30Z"));

  const page = new Page();
  const { core, since } = plant(page);
  const days: Day[] = [];

  const stop = followDay(
    core,
    (day) => {
      days.push(day);
    },
    page,
  );

  await drain();
  since();
  await pass(MINUTE);

  // The layout and the timezone are remembered, and the weather now is the closing quarter's.
  const day = { ...MOVING, [`devices/${PLANT}/history`]: 1, ...FORECASTS };

  expect(since()).toEqual(day);
  expect(days.at(-1)?.start.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  stop();
});

test("a hidden page reads nothing, and today is read whole when it is shown again", async () => {
  const page = new Page();
  const { core, since } = plant(page);
  const stop = followDay(core, () => {}, page);

  await drain();
  since();
  page.show(false);
  await pass(5 * MINUTE);

  expect(since()).toEqual({});

  page.show(true);
  await drain();

  // The weather now is the quarter's, read already.
  const whole = { ...MOVING, ...PLACE, [`devices/${PLANT}/history`]: 1, ...FORECASTS };

  expect(since()).toEqual(whole);
  stop();
});

test("a stopped day reads nothing more", async () => {
  const page = new Page();
  const { core, since } = plant(page);
  const stop = followDay(core, () => {}, page);

  await drain();
  stop();
  since();
  await pass(5 * MINUTE);

  expect(since()).toEqual({});
});
