import { expect, test } from "bun:test";
import { settleRead } from "../api/client.ts";
import { connect } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
import { readPlant } from "./plant-read.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2016-01-01T00:00:00Z");

/** A core whose history answers `answer(series)`, recording each read. */
type Answer =
  | { tier?: string; period?: string; points: object[] }
  | { problem: { code: string; status: number } };

function fake(answer: (series: string, kind: string) => Answer = () => ({ points: [] })) {
  const asked: Readonly<{ series: string; from: number; to: number }>[] = [];
  const requests: string[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const names = url.searchParams.getAll("series");
      const kind = url.pathname.split("/")[5] ?? "";
      const period = kind === "statistics" ? `:${url.searchParams.get("period")}` : "";

      requests.push(`${kind}${period}`);

      for (const series of names)
        asked.push({
          series: `${kind}:${url.pathname.split("/")[4]}:${series}${period}`,
          from: Date.parse(url.searchParams.get("from") ?? ""),
          to: Date.parse(url.searchParams.get("to") ?? ""),
        });

      // A refused series refuses the request, named (ADR 9).
      for (const series of names) {
        const body = answer(series, kind);

        if ("problem" in body)
          return Promise.resolve(
            Response.json(
              { ...body.problem, series },
              { status: 404, headers: { "content-type": "application/problem+json" } },
            ),
          );
      }

      return Promise.resolve(eachSeries(request.url, (series) => answer(series, kind)));
    },
  });

  return { asked, requests, core };
}

test("a month reads each plant flow's day rollups once, and the house load's history", async () => {
  const { core, asked, requests } = fake();

  await readPlant(core, T0, T0 + 31 * DAY);

  expect(asked.map((a) => a.series).toSorted()).toEqual([
    "history:4294967294:load.power",
    "statistics:4294967294:battery.charge.power:day",
    "statistics:4294967294:battery.discharge.power:day",
    "statistics:4294967294:ev.charge.power:day",
    "statistics:4294967294:grid.export.power:day",
    "statistics:4294967294:grid.import.power:day",
    "statistics:4294967294:load.power:day",
    "statistics:4294967294:pv.power:day",
    "statistics:4294967294:self.consumption.power:day",
    "statistics:4294967294:self.supply.power:day",
  ]);
  expect(asked.every((a) => a.to === T0 + 31 * DAY)).toBe(true);
  // Every flow in one read.
  expect(requests.toSorted()).toEqual(["history", "statistics:day"]);
});

test("a range of hour bands also reads every flow's hourly rollups, never a power history", async () => {
  const { core, asked, requests } = fake();

  await readPlant(core, T0, T0 + DAY, true);

  expect(asked.filter((a) => a.series.endsWith(":hour"))).toHaveLength(9);
  expect(requests.filter((r) => r === "statistics:hour")).toHaveLength(1);
  expect(asked.filter((a) => a.series.startsWith("history:"))).toHaveLength(1);
});

test("a series the plant lacks reads as none", async () => {
  const point = { start: "2016-01-01T10:00:00Z", end: "2016-01-01T11:00:00Z", mean: 900 };
  const day = { date: "2016-01-01", start: "2016-01-01T00:00:00Z", end: "2016-01-02T00:00:00Z" };

  // The core answers a series it stores nothing of with no points.
  const { core } = fake((s, kind) => {
    if (s === "battery.charge.power") return { points: [] };

    return kind === "history"
      ? { points: [point] }
      : { points: [{ ...day, integral: 900, mean: 37.5, hours: 24 }] };
  });

  const plant = await readPlant(core, T0, T0 + DAY, true);

  expect(plant.days.charge).toEqual([]);
  expect(plant.hours.charge).toEqual([]);
  expect(plant.load).toEqual([point]);
  expect(plant.days.pv).toEqual([
    { start: T0, end: T0 + DAY, integral: 900, mean: 37.5, max: null, covered: DAY },
  ]);
});

test("a refused read fails with the core's reason, never as an empty range", async () => {
  const { core } = fake((_, kind) =>
    kind === "statistics" ? { problem: { code: "history.range", status: 422 } } : { points: [] },
  );

  expect(await settleRead(readPlant(core, T0, T0 + DAY))).toMatchObject({
    failed: true,
    refused: { problem: "history.range" },
  });
});
