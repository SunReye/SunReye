/// <reference types="bun" />
// Range reads through `connect` (ADR 9, 11): one request for the series of one device, range and
// period asked at once, and a refused series apart.
import { expect, test } from "bun:test";
import { connect } from "./core.ts";
import type { Visibility } from "./live.ts";

const FROM = new Date("2026-11-12T00:00:00Z");
const TO = new Date("2026-11-12T12:00:00Z");

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
