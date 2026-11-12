import { describe, expect, test } from "bun:test";
import { ago, nodeReadings, type Reading, type Source } from "./readings";

const NOW = 1_000_000;
const fresh = (v: number | string, est = false): Reading => ({ v, at: NOW - 1000, ...(est && { est }) });

function plant(patch: Partial<Source> = {}, readings: Record<string, Reading> = {}): Source {
  return {
    strings: [
      { id: "s1", name: "Süd", input: 1 },
      { id: "s2", name: "Nord", input: 1 },
      { id: "s3", name: "West", input: 2 },
    ],
    readings: {
      "pv.power": fresh(7800),
      "inverter.power": fresh(7600),
      "pv.mppt.power[1]": fresh(4300),
      "pv.mppt.voltage[1]": fresh(536),
      "pv.mppt.current[1]": fresh(8),
      "pv.mppt.power[2]": fresh(3500),
      "pv.mppt.voltage[2]": fresh(469),
      "pv.mppt.current[2]": fresh(7.5),
      "pv.string.power[s1]": fresh(3100, true),
      "pv.string.power[s2]": fresh(1200, true),
      "pv.string.power[s3]": fresh(3500),
      "battery.power": fresh(-900),
      "battery.temperature": fresh(24),
      ...readings,
    },
    now: NOW,
    offline: [],
    status: "live",
    devices: { inverter: "WR", battery: "Akku", meter: "Zähler", ev: "Wallbox", plant: "Haus" },
    ...patch,
  };
}

const titles = (id: string, s: Source) => nodeReadings(id, s)!.groups.map((g) => g.title);
const row = (id: string, s: Source, key: string) => nodeReadings(id, s)!.groups.flatMap((g) => g.rows).find((r) => r.key === key);

describe("node readings", () => {
  test("a string sharing its MPPT input is an estimate with its share and its siblings", () => {
    const r = nodeReadings("s1", plant())!;
    expect(r.leadEstimated).toBe(true);
    expect(row("s1", plant(), "share")).toMatchObject({ value: (3100 / 4300) * 100, est: true });
    expect(row("s1", plant(), "pv.string.power[s2]")).toMatchObject({ label: "Nord", est: true, to: "s2" });
    expect(row("s1", plant(), "pv.mppt.power[1]")).toMatchObject({ value: 4.3, unit: "kW" });
  });

  test("a string alone on its input is measured and does not repeat the input's power", () => {
    const r = nodeReadings("s3", plant())!;
    expect(r.leadEstimated).toBe(false);
    expect(titles("s3", plant())).toEqual(["MPPT-Eingang 2"]);
    expect(row("s3", plant(), "pv.mppt.power[2]")).toBeUndefined();
  });

  test("a role the profile does not map gives no row and no column", () => {
    const { "pv.mppt.voltage[1]": _a, "pv.mppt.voltage[2]": _b, ...rest } = plant().readings;
    const s = plant({ readings: rest });
    expect(row("s1", s, "pv.mppt.voltage[1]")).toBeUndefined();
    const table = nodeReadings("inverter", s)!.groups.find((g) => g.title === "MPPT-Eingänge")!.table!;
    expect(table.cols.map((c) => c.label)).toEqual(["Strom", "Leistung"]);
  });

  test("a group without readings is dropped", () => {
    expect(titles("battery", plant())).toEqual(["Zustand"]);
  });

  test("the sign never reaches the reader", () => {
    const s = plant({}, { "battery.current": fresh(-17.5) });
    expect(row("battery", s, "battery.current")?.value).toBe(17.5);
  });

  test("a stale reading carries its age; a fresh one does not", () => {
    const s = plant({}, { "battery.temperature": { v: 24, at: NOW - 240_000 } });
    expect(row("battery", s, "battery.temperature")?.age).toBe(240);
    expect(row("battery", plant(), "battery.temperature")?.age).toBeUndefined();
  });

  test("an offline device says so once, not on every row", () => {
    const s = plant({ offline: ["battery"] }, { "battery.power": { v: -900, at: NOW - 720_000 }, "battery.temperature": { v: 24, at: NOW - 720_000 } });
    expect(nodeReadings("battery", s)!.silent).toBe(720);
    expect(row("battery", s, "battery.temperature")?.age).toBeUndefined();
  });

  test("efficiency is derived from the two powers", () => {
    expect(row("inverter", plant(), "efficiency")?.value).toBeCloseTo(97.44, 1);
  });

  test("a figure that is not a node has no readings", () => {
    expect(nodeReadings("production", plant())).toBeNull();
  });
});

test("ages read in the largest sensible unit", () => {
  expect([ago(42), ago(240), ago(3 * 3600)]).toEqual(["vor 42 s", "vor 4 min", "vor 3 h"]);
});
