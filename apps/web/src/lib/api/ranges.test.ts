/// <reference types="bun" />
// Range reads through `connect` (ADR 9, 11): one request for the series of one device, range and
// period asked at once, a refused series apart, and closed ranges kept for the session.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { connect } from "./core.ts";
import type { Visibility } from "./live.ts";

const FROM = new Date("2026-11-12T00:00:00Z");
const TO = new Date("2026-11-12T12:00:00Z");

/** Now: 2026-11-20 10:30 UTC, so a range ending by 09:00 is closed. */
const NOW = new Date("2026-11-20T10:30:00Z");

const DAY = { from: new Date("2026-11-19T00:00:00Z"), to: new Date("2026-11-19T09:00:00Z") };

afterEach(() => {
  setSystemTime();
});

/** A point ending at `end`. */
const point = (end: string) => ({ start: "2026-11-12T00:00:00Z", end, mean: 1 });

/** The series each answer names; a refusal names one only where the core said which. */
function named(read: readonly Readonly<{ series?: string }>[]): (string | undefined)[] {
  const names: (string | undefined)[] = [];

  for (const one of read) names.push(one.series);

  return names;
}

const ONE_POINT = [point("2026-11-12T01:00:00Z")];

/** A rejected read's error. */
const failed = (error: Readonly<Error>) => error;

/** A fake core answering each series it is asked with `points(series)`, refusing those in
 * `refused` by name, with every request it was asked. */
function fake(
  options: Readonly<{
    refused?: readonly string[];
    points?: (series: string) => readonly object[];
    page?: Visibility;
  }> = {},
) {
  const urls: string[] = [];
  const asked: (readonly string[])[] = [];

  const core = connect(
    {
      base: "http://core.test/",
      fetch: async (request) => {
        await Promise.resolve();

        if (request.method !== "GET") return new Response(null, { status: 204 });

        const url = new URL(request.url);
        const series = url.searchParams.getAll("series");

        urls.push(request.url);
        asked.push(series);

        const refused = series.find((s) => options.refused?.includes(s) === true);

        if (refused !== undefined)
          return Response.json(
            { status: 422, code: "history.range", series: refused },
            { status: 422, headers: { "content-type": "application/problem+json" } },
          );

        const kind = url.pathname.endsWith("/statistics") ? { period: "day" } : { tier: "raw" };

        return Response.json({
          series: series.map((s) =>
            Object.assign({ series: s, points: options.points?.(s) ?? ONE_POINT }, kind),
          ),
        });
      },
    },
    options.page,
  );

  return { core, urls, asked };
}

test("the series of one device, range and period asked at once go as one request", async () => {
  const { core, asked } = fake();

  const [a, b, day, other] = await Promise.all([
    core.statistics(1, ["pv.power"], "hour", FROM, TO),
    core.statistics(1, ["load.power", "pv.power"], "hour", FROM, TO),
    core.statistics(1, ["pv.power"], "day", FROM, TO),
    core.statistics(2, ["pv.power"], "hour", FROM, TO),
  ]);

  expect(asked).toEqual([["pv.power", "load.power"], ["pv.power"], ["pv.power"]]);
  expect(named(a)).toEqual(["pv.power"]);
  expect(named(b)).toEqual(["load.power", "pv.power"]);
  expect(day).toHaveLength(1);
  expect(other).toHaveLength(1);
});

test("history and forecasts batch alike, and a read asked meanwhile joins the one in flight", async () => {
  const { core, asked } = fake();

  const first = Promise.all([
    core.history(1, ["pv.power"], FROM, TO),
    core.forecasts(1, ["pv.power"], FROM, TO),
    core.forecasts(1, ["price.spot"], FROM, TO),
  ]);

  await Promise.resolve();

  const joined = core.history(1, ["pv.power"], FROM, TO);

  await Promise.all([first, joined]);

  expect(asked).toEqual([["pv.power"], ["pv.power", "price.spot"]]);
  expect((await joined)[0]).toMatchObject({ series: "pv.power", tier: "raw" });
});

test("more than 16 series go as requests of 16", async () => {
  const { core, asked } = fake();
  const series = Array.from({ length: 17 }, (_, i) => `pv.string.power[${i + 1}]`);

  const read = await core.history(1, series, FROM, TO);

  expect(asked.map((s) => s.length)).toEqual([16, 1]);
  expect(named(read)).toEqual(series);
});

test("a refused series goes to its callers alone; the others are asked again without it", async () => {
  const { core, asked } = fake({ refused: ["weather.code"] });

  const [read, alone] = await Promise.all([
    core.history(1, ["weather.ghi", "weather.code"], FROM, TO),
    core.history(1, ["weather.dhi"], FROM, TO),
  ]);

  expect(asked).toEqual([
    ["weather.ghi", "weather.code", "weather.dhi"],
    ["weather.ghi", "weather.dhi"],
  ]);
  expect(read).toEqual([
    { series: "weather.ghi", tier: "raw", points: [point("2026-11-12T01:00:00Z")] },
    { problem: "history.range", series: "weather.code" },
  ]);
  expect(alone[0]).toMatchObject({ series: "weather.dhi" });
});

test("a refusal naming no series goes to every series asked", async () => {
  const core = connect({
    base: "http://core.test/",
    fetch: () =>
      Promise.resolve(
        Response.json(
          { status: 401, code: "auth.required" },
          { status: 401, headers: { "content-type": "application/problem+json" } },
        ),
      ),
  });

  const read = await core.history(1, ["pv.power", "load.power"], FROM, TO);

  expect(read).toEqual([{ problem: "auth.required" }, { problem: "auth.required" }]);
});

test("an open range is asked again once settled", async () => {
  setSystemTime(NOW);

  const { core, asked } = fake();
  const today = { from: new Date("2026-11-20T00:00:00Z"), to: new Date("2026-11-20T10:30:00Z") };

  await core.history(1, ["pv.power"], today.from, today.to);
  // Ends after the start of the previous hour, 09:00: its rollup is still being written.
  await core.history(1, ["pv.power"], DAY.from, new Date("2026-11-19T09:00:01Z"));
  await core.history(1, ["pv.power"], today.from, today.to);

  expect(asked).toHaveLength(3);
});

test("a closed range is kept: asked later, its series are not asked again", async () => {
  setSystemTime(NOW);

  const { core, asked } = fake({ points: () => [point("2026-11-19T09:00:00Z")] });

  const first = await core.history(1, ["pv.power", "load.power"], DAY.from, DAY.to);
  const later = await core.history(1, ["load.power", "grid.import.power"], DAY.from, DAY.to);

  expect(asked).toEqual([["pv.power", "load.power"], ["grid.import.power"]]);
  expect(later[0]).toEqual(first[1]);
});

test("a closed range whose last period runs past it, as a month under way, is not kept", async () => {
  setSystemTime(NOW);

  const { core, asked } = fake({ points: () => [point("2026-12-01T00:00:00Z")] });
  const month = [new Date("2026-11-01T00:00:00Z"), new Date("2026-11-02T00:00:00Z")] as const;

  await core.statistics(1, ["pv.power"], "month", ...month);
  await core.statistics(1, ["pv.power"], "month", ...month);

  expect(asked).toHaveLength(2);
});

test("a write or the page shown again forgets closed ranges", async () => {
  setSystemTime(NOW);

  const page = Object.assign(new EventTarget(), { hidden: false });
  const { core, asked } = fake({ points: () => [point("2026-11-19T09:00:00Z")], page });
  const read = () => core.history(1, ["pv.power"], DAY.from, DAY.to);

  await read();
  await core.setTimezone("Europe/Berlin");
  await read();
  page.dispatchEvent(new Event("visibilitychange"));
  await read();
  await read();

  expect(asked).toHaveLength(3);
});

test("closed ranges are kept up to 200,000 points, the least recently used dropped first", async () => {
  setSystemTime(NOW);

  const many = Array.from({ length: 80_000 }, () => point("2026-11-19T09:00:00Z"));
  const { core, asked } = fake({ points: () => many });
  const read = (series: string) => core.history(1, [series], DAY.from, DAY.to);

  await read("a");
  await read("b");
  await read("a");
  // 240,000 points: b, the least recently used, goes.
  await read("c");
  await read("a");
  await read("b");

  expect(asked).toEqual([["a"], ["b"], ["c"], ["b"]]);
});

test("an answer of another shape, or one missing a series asked, fails those series", async () => {
  const answers = [Response.json({ points: [] }), Response.json({ series: [] })];

  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.resolve(answers.shift() ?? Response.json({ series: [] })),
  });

  const other = core.history(1, ["pv.power"], FROM, TO).then(() => null, failed);

  const missing = core
    .history(1, ["pv.power"], FROM, new Date(TO.getTime() + 1))
    .then(() => null, failed);

  expect(await other).toBeInstanceOf(Error);
  expect(await missing).toBeInstanceOf(Error);
});
