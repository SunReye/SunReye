import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { higher } from "./bench/host.ts";
import { openingMoment } from "./bench/plant.ts";
import {
  BUDGETS,
  cpu,
  inUse,
  measured,
  p95,
  perDay,
  route,
  slowest,
  table,
  written,
} from "./bench/report.ts";
import { HOUR, WEATHER } from "./bench/reads.ts";
import { imageTag, indexReach } from "./bench/store.ts";

test("p95 is the nearest-rank sample", () => {
  const samples = Array.from({ length: 30 }, (_, i) => 30 - i);

  // Rank ceil(0.95 × 30) = 29 of 1..30.
  expect(p95(samples)).toBe(29);
  expect(p95([7])).toBe(7);
});

test("bytes written count one device of the stack, not each layer of it", () => {
  const stat = [
    "259:1 rbytes=1220608 wbytes=8192 rios=37 wios=2 dbytes=0 dios=0",
    "253:3 rbytes=1220608 wbytes=8192 rios=37 wios=2 dbytes=0 dios=0",
    "253:16 rbytes=0 wbytes=4096 rios=0 wios=1 dbytes=0 dios=0",
    "",
  ].join("\n");

  expect(written(stat)).toBe(8192);
  expect(written("")).toBe(0);
});

test("memory in use leaves out the file cache the kernel may drop", () => {
  const stat = ["anon 20971520", "file 41943040", "active_file 8388608", "inactive_file 33554432"];

  expect(inUse("66060288\n", stat.join("\n"))).toEqual({ workingSet: 32505856, anon: 20971520 });
});

test("CPU time and throttling come from cpu.stat in microseconds", () => {
  const stat = "usage_usec 1500000\nuser_usec 1000000\nnr_throttled 3\nthrottled_usec 120000\n";

  expect(cpu(stat)).toEqual({ usage: 1500, throttled: 120 });
});

test("a route answers for its slowest request, however rare among the route's reads", () => {
  const day = "/api/v1/devices/1/history?series=x&from=a&to=b";
  const year = "/api/v1/devices/1/history?series=x&from=c&to=d";

  const timings = [
    ...Array.from({ length: 30 }, () => ({ path: day, ms: 5 })),
    ...Array.from({ length: 2 }, () => ({ path: year, ms: 900 })),
    { path: "/api/v1/sun-tint", ms: 1 },
  ];

  expect(slowest(timings)).toEqual([
    { route: "/api/v1/devices/{id}/history", path: year, p95: 900, samples: 2 },
    { route: "/api/v1/sun-tint", path: "/api/v1/sun-tint", p95: 1, samples: 1 },
  ]);
});

test("bytes written over a window scale to a day", () => {
  // 2 min is a 720th of a day.
  expect(perDay(1_000_000, 120_000)).toBe(720_000_000);
});

test("an image is reused only for a clean tree, by its full commit", () => {
  const sha = "d8d1dda2c0ffee00d8d1dda2c0ffee00d8d1dda2";

  expect(imageTag(sha, "")).toEqual({ tag: `sunreye-bench:${sha}`, reusable: true });
  expect(imageTag(sha, " M scripts/bench.ts\n")).toEqual({
    tag: `sunreye-bench:${sha}-dirty`,
    reusable: false,
  });
});

test("peak memory over two starts keeps each figure's own highest", () => {
  const first = { workingSet: 30, anon: 12, resident: 18 };
  const second = { workingSet: 41, anon: 9, resident: 20 };

  expect(higher(first, second)).toEqual({ workingSet: 41, anon: 12, resident: 20 });
});

test("a measurement that met an error fails, whatever it took", () => {
  expect(measured("backup", BUDGETS.backup, 900, "HTTP 500 on /api/v1/backups")).toEqual({
    measurement: "backup",
    budget: BUDGETS.backup,
    failed: "HTTP 500 on /api/v1/backups",
  });
  expect(measured("backup", BUDGETS.backup, 900, null)).toEqual({
    measurement: "backup",
    budget: BUDGETS.backup,
    result: 900,
  });
});

test("screens open on the evening of the file's last whole plant-local day", () => {
  // The file's last hour ends at 02:00 Berlin on 1 November: that day is barely begun.
  const end = Date.parse("2026-11-01T01:00:00Z");

  expect(new Date(openingMoment(end, "Europe/Berlin")).toISOString()).toBe(
    "2026-10-31T17:00:00.000Z",
  );
  // Ending at a plant-local midnight, the day before it is whole.
  expect(
    new Date(openingMoment(Date.parse("2026-10-31T23:00:00Z"), "Europe/Berlin")).toISOString(),
  ).toBe("2026-10-31T17:00:00.000Z");
});

test("a read's route names its ids and a statistics read's period, not its range", () => {
  const read = "/api/v1/devices/4294967294/statistics?series=pv.power&period=hour&from=a&to=b";

  expect(route(read)).toBe("/api/v1/devices/{id}/statistics?period=hour");
  expect(route("/api/v1/devices/3/history?series=x&from=a")).toBe("/api/v1/devices/{id}/history");
  expect(route("/api/v1/sun-tint")).toBe("/api/v1/sun-tint");
});

test("a result over its budget, or one that failed, is a breach; a skipped one is not", () => {
  const { lines, breaches } = table([
    { measurement: "startup", budget: BUDGETS.startup, result: 4200 },
    { measurement: "backup", budget: BUDGETS.backup, result: 150_000 },
    { measurement: "dashboard warm p95", budget: BUDGETS.screenWarm, failed: "HTTP 400 on /x" },
    { measurement: "corrections", budget: BUDGETS.job, skipped: "needs the archive" },
    { measurement: "peak memory", budget: BUDGETS.memory, result: 40.5 * 2 ** 20 },
    { measurement: "restore", budget: null, result: 61_000, unit: "ms" },
    { measurement: "one read p95", budget: BUDGETS.read, result: 87.25 },
  ]);

  expect(breaches).toBe(2);
  expect(lines).toEqual([
    "| measurement | budget | result | verdict |",
    "|---|---|---|---|",
    "| startup | ≤ 5 s | 4.2 s | pass |",
    "| backup | ≤ 2 min | 150.0 s | FAIL |",
    "| dashboard warm p95 | ≤ 150 ms | HTTP 400 on /x | FAIL |",
    "| corrections | ≤ 30 s | not measured: needs the archive | n/a |",
    "| peak memory | ≤ 48 MB | 40.5 MB | pass |",
    "| restore | — | 61.0 s | — |",
    "| one read p95 | ≤ 100 ms | 87 ms | pass |",
  ]);
});

test("the clear-sky index reaches its newest hour, kept as a block where retention left no rollup", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "bench-")), "core.sqlite");
  const db = new Database(file);

  db.run("CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("CREATE TABLE block (device INTEGER, series INTEGER, hour INTEGER)");
  db.run("CREATE TABLE rollup_hour (device INTEGER, series INTEGER, hour INTEGER)");
  db.run("INSERT INTO series VALUES (7, 'weather.clearness'), (8, 'pv.power')");
  db.run(`INSERT INTO block VALUES (${WEATHER}, 7, 410544), (${WEATHER}, 8, 420000)`);
  db.close();

  expect(indexReach(file)).toBe(410545 * HOUR);
});

test("a batch is held to the one-read budget per series it reads", () => {
  const batch = "/api/v1/devices/1/history?series=a&series=b&series=c&series=d&from=x&to=y";

  expect(slowest([{ path: batch, ms: 200 }])).toEqual([
    { route: "/api/v1/devices/{id}/history", path: batch, p95: 50, samples: 1 },
  ]);
});
