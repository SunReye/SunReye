import { expect, test } from "bun:test";

import { coalescing } from "./bench/coalesce.ts";

/** A read that answers every path with an empty object, and the paths it was asked. */
function recording() {
  const asked: string[] = [];

  const read = coalescing((path) => {
    asked.push(path);

    return Promise.resolve("{}");
  });

  return { asked, read };
}

test("range reads of one device, range and period asked at once go as one request", async () => {
  const { asked, read } = recording();

  await Promise.all([
    read("/api/v1/devices/1/statistics?series=a&period=day&from=x&to=y"),
    read("/api/v1/devices/1/statistics?series=b&series=a&period=day&from=x&to=y"),
    read("/api/v1/devices/1/statistics?series=a&period=hour&from=x&to=y"),
    read("/api/v1/devices/2/history?series=a&from=x&to=y"),
    read("/api/v1/series"),
  ]);

  expect(asked.toSorted()).toEqual([
    "/api/v1/devices/1/statistics?series=a&period=hour&from=x&to=y",
    "/api/v1/devices/1/statistics?series=a&series=b&period=day&from=x&to=y",
    "/api/v1/devices/2/history?series=a&from=x&to=y",
    "/api/v1/series",
  ]);
});

test("more than 16 series asked at once go as requests of 16", async () => {
  const { asked, read } = recording();

  await Promise.all(
    Array.from({ length: 17 }, (_, i) => read(`/api/v1/devices/1/history?series=s${i}&from=x`)),
  );

  expect(
    asked.map((path) => new URLSearchParams(path.split("?")[1]).getAll("series").length),
  ).toEqual([16, 1]);
});
