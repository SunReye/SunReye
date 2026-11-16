import { expect, test } from "bun:test";
import type { Core } from "../api/core.ts";
import { storedSeries } from "./plant-facts.ts";

type Answer = Awaited<ReturnType<Core["series"]>>;

const reads = (answer: () => Promise<Answer>) => storedSeries({ series: answer });

test("each stored series is named by its device", async () => {
  const catalog: Answer = [
    {
      id: 2,
      name: "Speicher",
      removed: false,
      series: [
        {
          series: "battery.soc",
          kind: "measurement",
          unit: "%",
          estimated: false,
          first: "2026-11-01T00:00:00Z",
          last: "2026-11-12T12:00:00Z",
        },
      ],
    },
  ];

  expect(await reads(() => Promise.resolve(catalog))).toEqual(["2/battery.soc"]);
});

test("a catalog that cannot be read leaves every reading unlinked", async () => {
  expect(await reads(() => Promise.resolve({ problem: "auth.required" }))).toEqual([]);
  expect(await reads(() => Promise.reject(new TypeError("network")))).toEqual([]);
});
