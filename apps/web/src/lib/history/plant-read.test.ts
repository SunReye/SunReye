import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { readPlant } from "./plant-read.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2016-01-01T00:00:00Z");

/** A core whose history answers `answer(series)`, recording each read. */
type Answer =
  | { tier?: string; period?: string; points: object[] }
  | { problem: { code: string; status: number } };

function fake(answer: (series: string, kind: string) => Answer = () => ({ points: [] })) {
  const asked: Readonly<{ series: string; from: number; to: number }>[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const series = url.searchParams.get("series") ?? "";
      const kind = url.pathname.split("/")[5] ?? "";
      const body = answer(series, kind);

      asked.push({
        series: `${kind}:${url.pathname.split("/")[4]}:${series}${kind === "statistics" ? `:${url.searchParams.get("period")}` : ""}`,
        from: Date.parse(url.searchParams.get("from") ?? ""),
        to: Date.parse(url.searchParams.get("to") ?? ""),
      });

      return Promise.resolve(
        "problem" in body
          ? Response.json(body.problem, {
              status: 404,
              headers: { "content-type": "application/problem+json" },
            })
          : Response.json(body),
      );
    },
  });

  return { asked, core };
}

test("a month reads each plant flow's day rollups once, and the house load's history", async () => {
  const { core, asked } = fake();

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
});

test("a range of hour bands also reads every flow's hourly rollups, never a power history", async () => {
  const { core, asked } = fake();

  await readPlant(core, T0, T0 + DAY, true);

  expect(asked.filter((a) => a.series.endsWith(":hour"))).toHaveLength(9);
  expect(asked.filter((a) => a.series.startsWith("history:"))).toHaveLength(1);
});

test("a series the plant lacks reads as none", async () => {
  const point = { start: "2016-01-01T10:00:00Z", end: "2016-01-01T11:00:00Z", mean: 900 };
  const day = { date: "2016-01-01", start: "2016-01-01T00:00:00Z", end: "2016-01-02T00:00:00Z" };

  const { core } = fake((s, kind) => {
    if (s === "battery.charge.power") return { problem: { code: "history.series", status: 404 } };

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
