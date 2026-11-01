/**
 * The oracle corpus's database groups — rollups, statistics and archives — against the 2.x code
 * and a real TimescaleDB (`fixtures/oracle/`, ADR 0002).
 *
 * Runs only under `bun run test:db`, on `sunreye_dbtest` and nowhere else. Two jobs:
 *  - compare what the 2.x code produces now with the committed files, failing on any difference;
 *  - with `ORACLE_WRITE=1` (set by `scripts/oracle/generate.ts`), write them instead.
 *
 * The numeric tests below hold expected values worked out by hand, not read back from the output,
 * so a corpus that drifted together with the code under it would still fail here.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { databaseReachable, resetTestDatabase } from "./harness";
import { buildArchives } from "./oracle/archives";
import { buildRollupAndStatistics } from "./oracle/build";
import { type Files, stale, write } from "./oracle/files";
import { CASES } from "./oracle/streams";

const reachable = await databaseReachable();

const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;
const WRITE = process.env.ORACLE_WRITE === "1";

type Line = Record<string, any>;
const lines = (text: string | Uint8Array): Line[] =>
  String(text)
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line);

suite("the oracle corpus, database groups", () => {
  let files: Files = {};
  let rollups = new Map<string, Line>();
  let statistics = new Map<string, Line>();
  const imports = new Map<string, Line>();

  beforeAll(async () => {
    const url = await resetTestDatabase();
    const raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    files = { ...(await buildRollupAndStatistics(raw)), ...(await buildArchives(raw, url)) };
    for (const id of ["current-2.x", "legacy-1.2.0"]) {
      imports.set(id, JSON.parse(String(files[`archives/${id}/expected-import.json`])) as Line);
    }
    rollups = new Map(lines(files["rollups.ndjson"]!).map((l) => [l.case, l]));
    statistics = new Map(lines(files["statistics.ndjson"]!).map((l) => [l.case, l]));
  }, 300_000);

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  test(
    WRITE ? "writes the corpus" : "the committed corpus is what the 2.x code produces",
    async () => {
      if (WRITE) {
        await write(files);
        return;
      }
      expect(await stale(files)).toEqual([]);
    },
  );

  test("every boundary the ticket lists has a case", () => {
    const ids = CASES.map((c) => c.id).join(" ");
    for (const boundary of [
      "dst-spring",
      "dst-autumn",
      "midnight-crossing",
      "counter-restart",
      "partial-window",
      "zero-and-negative",
      "absent-readings",
      "stale-across-midnight",
    ]) {
      expect(ids).toContain(boundary);
    }
  });

  describe("rollups", () => {
    const avgs = (id: string, key: string, bucket: string): number[] =>
      rollups.get(id)!.tiers[key][bucket].map((r: { avg: number }) => r.avg);

    test("a value held across midnight is shared between the hours it spans", () => {
      // 100 W 22:50-23:10 and 200 W after: 23:00Z hour = (10 min x 100 + 50 min x 200) / 60.
      expect(avgs("midnight-crossing", "oracle.power", "hour")).toEqual([
        100, 183.33333333333334, 200, 200,
      ]);
    });

    test("zero and negative power survive as readings", () => {
      expect(avgs("zero-and-negative", "oracle.power", "hour")).toEqual([
        0, 0, -300, -1500, 0, 250,
      ]);
    });

    test("an hour with no reading has no bucket", () => {
      const hours = rollups
        .get("absent-readings")!
        .tiers["oracle.production.total"].hour.map((r: { time: string }) => r.time);
      expect(hours).not.toContain("2026-04-02T06:00:00.000Z");
      expect(hours).not.toContain("2026-04-02T08:00:00.000Z");
      expect(hours).toContain("2026-04-02T09:00:00.000Z");
    });

    test("a stale reading is carried across midnight: 250 W holds until the next reading", () => {
      // 19:00Z hour: 300 W for 30 min, then 250 W for 30 min.
      expect(avgs("stale-across-midnight", "oracle.power", "hour")[1]).toBe(275);
    });

    test("the daily tier holds one bucket per UTC day with the counter's high and low", () => {
      const days = rollups.get("counter-restart")!.tiers["oracle.production.total"].day;
      expect(days).toHaveLength(1);
      expect(days[0]).toMatchObject({ time: "2026-06-10T00:00:00.000Z", max: 5004, min: 2 });
    });
  });

  describe("statistics", () => {
    const column = (id: string, series: string, field: string): number[] =>
      statistics.get(id)![series].map((p: Line) => p[field]);

    test("counter restart: the restart hour and the hour after it book nothing", () => {
      // Hourly highs 5000.5, 5001.5, 5002.5, 5003.5, 5004, 3, 4, 5. Each hour books its rise over
      // the previous hour's high, clamped at zero: 3 - 5004 is 0, and the rise inside the restart
      // hour (2 -> 3) is lost with it. The first hour has no predecessor and books its own spread.
      const hours = statistics.get("counter-restart")!.hourly.map((h: Line) => h.production);
      expect(hours).toEqual([0.5, 1, 1, 1, 0.5, 0, 1, 1]);
    });

    test("a spurious low sample costs one bucket and books its rise back in the next", () => {
      const hours = statistics.get("spurious-low-read")!.hourly.map((h: Line) => h.import);
      expect(hours[0]).toBe(0);
      expect(hours[1]).toBeCloseTo(0.2, 9);
      expect(hours[2]).toBe(0);
      expect(hours[3]).toBeCloseTo(150.5, 9);
      expect(hours[4]).toBeCloseTo(0.2, 9);
    });

    test("a recording gap longer than 3 hours is not bridged by an hourly delta", () => {
      const hours = statistics.get("absent-readings")!.hourly;
      const production = hours.map((h: Line) => h.production);
      expect(production.reduce((a: number, b: number) => a + b, 0)).toBe(6);
      const nine = hours.find((h: Line) => h.time === "2026-04-02T09:00:00.000Z")!;
      expect(nine.production).toBe(0);
    });

    test("spring forward: the local day has 23 hourly buckets of 0.4 kWh", () => {
      const days = statistics.get("dst-spring-2026-03-29")!.dailyLocal;
      expect(days.map((d: Line) => d.bucket)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
      expect(days[1].importKwh).toBeCloseTo(23 * 0.4, 9);
      expect(days[0].importKwh).toBeCloseTo(24 * 0.4, 9);
    });

    test("fall back: the local day has 25 hourly buckets of 0.4 kWh", () => {
      const days = statistics.get("dst-autumn-2026-10-25")!.dailyLocal;
      expect(days.map((d: Line) => d.bucket)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
      expect(days[1].importKwh).toBeCloseTo(25 * 0.4, 9);
    });

    test("the daily view buckets by UTC day, labelled with the plant-local date it starts on", () => {
      // 18 kWh of solar on each of 27, 28 and 29 March UTC; local-day sums equal them here only
      // because the roof is dark across both midnights.
      expect(column("dst-spring-2026-03-29", "daily", "productionKwh")).toEqual([18, 18, 0]);
    });

    test("monthly and yearly split at New Year", () => {
      const stat = statistics.get("year-boundary")!;
      expect(stat.monthly.map((p: Line) => p.bucket)).toEqual(["2025-12", "2026-01"]);
      expect(stat.monthly.map((p: Line) => p.productionKwh)).toEqual([22, 32]);
      expect(stat.yearly.map((p: Line) => [p.bucket, p.productionKwh])).toEqual([
        ["2025", 22],
        ["2026", 32],
      ]);
    });

    test("with no load counter the house load is implied from the flows", () => {
      const day = statistics.get("year-boundary")!.daily[1];
      // production + import - export, clamped at zero.
      expect(day.loadKwh).toBeCloseTo(
        Math.max(0, day.productionKwh + day.importKwh - day.exportKwh),
        9,
      );
    });
  });

  describe("archives", () => {
    test("the current archive imports every stream it declares, with nothing short", () => {
      const result = imports.get("current-2.x")!;
      expect(result.result.skipped).toBeNull();
      expect(result.result.inserted).toEqual({
        raw: 6,
        minute: 0,
        hourly: 4,
        daily: 4,
        configLog: 2,
      });
      // Only partial coverage is reported; a row the file declares and the import lost would be a
      // "shortfall" problem.
      expect(result.result.problems.every((p: string) => p.startsWith("no tier covered"))).toBe(
        true,
      );
    });

    test("automation stays enabled and the user's held register value survives", () => {
      const settings = imports.get("current-2.x")!.settings;
      expect(settings.automations.enabled).toBe(true);
      expect(settings.automations.peakShaving.enabled).toBe(true);
      // The charge-current the user had set (60 A) is held by the automation until it lets go.
      expect(Object.values(settings.automationState)).toEqual([
        { previousValue: 60, capturedAt: "2026-05-01T10:00:00.000Z" },
      ]);
    });

    test("the plant graph comes back by name: plant, endpoint, device, battery pack", () => {
      const imported = imports.get("current-2.x")!;
      expect(imported.plant).toMatchObject({ slug: "oracle-archive", time_zone: "Europe/Berlin" });
      expect(imported.connections).toEqual([
        {
          name: "Gateway",
          kind: "modbus",
          params: {
            host: "10.20.0.62",
            port: 8899,
            transport: "solarman-v5",
            timeoutMs: 3000,
            pollIntervalMs: 2000,
          },
        },
      ]);
      expect(imported.devices[0]).toMatchObject({
        slug: "oracle-archive-inverter",
        profile_id: "deye-sg05lp3",
        connection: "Gateway",
        usable_kwh: 10,
      });
    });

    test("counter class travels with the metric key", () => {
      const keys = Object.fromEntries(
        imports.get("current-2.x")!.metricKeys.map((k: Line) => [k.key, k.is_counter]),
      );
      expect(keys).toEqual({
        "oracle.archive.energy.total": true,
        "oracle.archive.power": false,
        "oracle.archive.settings.max_charge_current": false,
      });
    });

    test("raw rows land as written; configuration registers go to the config log only", () => {
      const imported = imports.get("current-2.x")!;
      const energy = imported.raw
        .filter((r: Line) => r.metric === "oracle.archive.energy.total" && r.time >= "2026-05-01")
        .map((r: Line) => r.value);
      expect(energy).toEqual([5000, 5000.2, 5000.3]);
      expect(imported.configLog.map((r: Line) => r.value)).toEqual([60, 40]);
    });

    test("the 1.2.0-era archive restores a plant, endpoint and device synthesised from 1.x settings", () => {
      const imported = imports.get("legacy-1.2.0")!;
      expect(imported.result.skipped).toBeNull();
      expect(imported.plant).toMatchObject({ slug: "oracle-legacy", time_zone: "Europe/Berlin" });
      expect(imported.connections[0]).toMatchObject({ name: "Modbus", kind: "modbus" });
      expect(imported.devices[0]).toMatchObject({
        slug: "oracle-legacy-profile",
        profile_id: "oracle-legacy-profile",
        unit_id: 1,
      });
      expect(imported.devices[0].usable_kwh).toBeNull();
    });

    test("1.2.0 buckets arrive for the days a tier covers whole; a partial day is reported, not replayed", () => {
      const imported = imports.get("legacy-1.2.0")!;
      expect(imported.result.inserted).toEqual({
        raw: 8,
        minute: 6,
        hourly: 24,
        daily: 6,
        configLog: 0,
      });
      expect(imported.result.problems.every((p: string) => p.startsWith("no tier covered"))).toBe(
        true,
      );
      // The three minute rows sit on 10 February, which no tier covers whole.
      expect(imported.raw.filter((r: Line) => r.time.startsWith("2026-02-10"))).toEqual([]);
    });

    test("a lifetime counter that loses its total mid-day keeps its per-day energy", () => {
      // A step belongs to the day of its later reading: 40992.3 (hour 23 of 9 February) -> 41000.2
      // is 7.9, then 0.4 up, the restart to 0.1 books the new level, 0.1, then 0.4 up: 8.8. Not
      // max - min, which is 41000.5.
      const day = imports
        .get("legacy-1.2.0")!
        .energyPerDay.find(
          (d: Line) => d.day === "2026-02-11" && d.metric === "oracle.legacy.energy.total",
        );
      expect(day.energy).toBeCloseTo(8.8, 6);
      expect(day.naive).toBeCloseTo(41000.5, 6);
    });
  });
});
