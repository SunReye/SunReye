import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { readPlant } from "./plant-read.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2016-01-01T00:00:00Z");

/** A core whose history answers `answer(series)`, recording each read. */
type Answer = { tier: string; points: object[] } | { problem: { code: string; status: number } };

function fake(answer: (series: string) => Answer = () => ({ tier: "day", points: [] })) {
  const asked: Readonly<{ series: string; from: number; to: number }>[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const series = url.searchParams.get("series") ?? "";
      const body = answer(series);

      asked.push({
        series: `${url.pathname.split("/")[4]}:${series}`,
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

test("a month reads each plant power once", async () => {
  const { core, asked } = fake();

  await readPlant(core, T0, T0 + 31 * DAY);

  expect(asked.map((a) => a.series).toSorted()).toEqual([
    "4294967294:battery.power",
    "4294967294:ev.charge.power",
    "4294967294:grid.export.power",
    "4294967294:grid.import.power",
    "4294967294:load.power",
    "4294967294:pv.power",
    "4294967294:self.consumption.power",
    "4294967294:self.supply.power",
  ]);
  expect(asked.every((a) => a.to === T0 + 31 * DAY)).toBe(true);
});

test("ten years read in pieces the day tier serves, end to end", async () => {
  const { core, asked } = fake();

  await readPlant(core, T0, T0 + 3653 * DAY);

  const pv = asked.filter((a) => a.series.endsWith(":pv.power"));

  expect(pv.length).toBeGreaterThan(1);
  expect(pv.every((a) => a.to - a.from <= 1498 * DAY)).toBe(true);
  expect(pv[0]!.from).toBe(T0);
  expect(pv.at(-1)!.to).toBe(T0 + 3653 * DAY);
  expect(pv.slice(1).every((a, i) => a.from === pv[i]!.to)).toBe(true);
});

test("a series the plant lacks reads as none", async () => {
  const point = { start: "2016-01-01T10:00:00Z", end: "2016-01-01T11:00:00Z", mean: 900 };

  const { core } = fake((s) =>
    s === "battery.power"
      ? { problem: { code: "history.series", status: 404 } }
      : { tier: "hour", points: [point] },
  );

  const plant = await readPlant(core, T0, T0 + DAY);

  expect(plant.battery).toEqual([]);
  expect(plant.pv).toEqual([point]);
});
