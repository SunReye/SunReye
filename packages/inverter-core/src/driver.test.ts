import { describe, expect, test } from "bun:test";

import { planReads, splitBlock } from "./driver";
import { computeExprInputs } from "./profile-data";
import type { MetricDef, RegisterType } from "./types";

/** Minimal raw register metric. */
const raw = (key: string, addr: number, type: RegisterType = "U_WORD") =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    type,
    addresses: type === "U_DWORD" ? [addr, addr + 1] : [addr],
    scale: 1,
    access: "r",
  }) as MetricDef;

/** Minimal computed metric — only `computeInputs` matters to the planner. */
const derived = (key: string, computeInputs: string[]) =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    type: "U_WORD",
    addresses: [],
    scale: 1,
    access: "r",
    compute: () => 0,
    computeInputs,
  }) as MetricDef;

describe("computeExprInputs", () => {
  test("extracts the read keys of every expression kind", () => {
    expect(computeExprInputs({ sum: ["a", "b"] })).toEqual(["a", "b"]);
    expect(computeExprInputs({ diff: ["a", "b"] })).toEqual(["a", "b"]);
    expect(computeExprInputs({ scale: ["a", 0.1] })).toEqual(["a"]);
    expect(computeExprInputs({ combine: { add: ["a", "b"], sub: ["c"] } })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(computeExprInputs({ combine: { add: ["a"] } })).toEqual(["a"]);
    expect(computeExprInputs({ clamp: { key: "a", min: 0 } })).toEqual(["a"]);
    expect(computeExprInputs({ ratio: { num: ["a"], den: ["b", "c"], scale: 100 } })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("planReads", () => {
  test("collapses contiguous addresses and splits on gaps (no computed metrics)", () => {
    const metrics = [raw("a", 10), raw("b", 11), raw("c", 12), raw("d", 200), raw("e", 201)];
    expect(planReads(metrics)).toEqual([
      { start: 10, count: 3 },
      { start: 200, count: 2 },
    ]);
  });

  test("spans a computed metric's inputs into one atomic block across gaps", () => {
    // Deye power-flow layout: battery 590, grid 625, load 653, PV 672-675.
    const metrics = [
      raw("battery.power", 590),
      raw("ac.total_power", 625),
      raw("ac.ups.total_power", 653),
      raw("dc.pv1.power", 672),
      raw("dc.pv2.power", 673),
      raw("dc.pv3.power", 674),
      raw("dc.pv4.power", 675),
      derived("dc.total_power", ["dc.pv1.power", "dc.pv2.power", "dc.pv3.power", "dc.pv4.power"]),
      derived("inverter.power", [
        "dc.total_power",
        "battery.power",
        "ac.total_power",
        "ac.ups.total_power",
      ]),
    ];
    expect(planReads(metrics)).toEqual([{ start: 590, count: 86, grouped: true }]);
  });

  test("resolves inputs transitively through chained computed metrics", () => {
    const metrics = [
      raw("battery.power", 590),
      raw("dc.total", 672),
      derived("battery.discharge", ["battery.power"]), // clamp
      derived("battery.charge", ["battery.discharge", "battery.power"]), // diff
      derived("efficiency", ["dc.total", "battery.charge"]), // ratio
    ];
    expect(planReads(metrics)).toEqual([{ start: 590, count: 83, grouped: true }]);
  });

  test("plans ungrouped addresses around an atomic block", () => {
    const metrics = [
      raw("a", 100),
      raw("b", 590),
      raw("c", 600),
      raw("d", 900),
      derived("x", ["b", "c"]),
    ];
    expect(planReads(metrics)).toEqual([
      { start: 100, count: 1 },
      { start: 590, count: 11, grouped: true },
      { start: 900, count: 1 },
    ]);
  });

  test("addresses inside an atomic span are not read a second time", () => {
    const metrics = [raw("a", 590), raw("mid", 600), raw("b", 610), derived("x", ["a", "b"])];
    // `mid` falls inside the 590-610 span; a second read of it would overwrite
    // the atomic sample with a later one.
    expect(planReads(metrics)).toEqual([{ start: 590, count: 21, grouped: true }]);
  });

  test("merges computed groups whose address ranges overlap", () => {
    const metrics = [
      raw("a", 100),
      raw("b", 150),
      raw("c", 140),
      raw("d", 180),
      derived("x", ["a", "b"]), // 100-150
      derived("y", ["c", "d"]), // 140-180 — overlaps x
    ];
    expect(planReads(metrics)).toEqual([{ start: 100, count: 81, grouped: true }]);
  });

  test("a group wider than the register cap falls back to split reads (and warns)", () => {
    // The LogTape warning is a no-op here (no sinks configured in tests); the
    // observable contract is the split fallback plan.
    const metrics = [raw("a", 100), raw("b", 400), derived("x", ["a", "b"])];
    expect(planReads(metrics)).toEqual([
      { start: 100, count: 1 },
      { start: 400, count: 1 },
    ]);
  });

  test("single-register groups need no atomic block", () => {
    const metrics = [raw("a", 100), derived("x", ["a"]), derived("y", ["a", "missing"])];
    expect(planReads(metrics)).toEqual([{ start: 100, count: 1 }]);
  });

  test("U_DWORD inputs contribute both words to the group", () => {
    const metrics = [raw("wide", 500, "U_DWORD"), raw("b", 510), derived("x", ["wide", "b"])];
    expect(planReads(metrics)).toEqual([{ start: 500, count: 11, grouped: true }]);
  });
});

describe("splitBlock", () => {
  test("re-plans a spanning block into gap-split blocks of its mapped addresses", () => {
    const metrics = [
      raw("a", 590),
      raw("b", 625),
      raw("c", 626),
      raw("d", 675),
      raw("outside", 900),
      derived("x", ["a", "b", "c", "d"]),
    ];
    expect(splitBlock({ start: 590, count: 86, grouped: true }, metrics)).toEqual([
      { start: 590, count: 1 },
      { start: 625, count: 2 },
      { start: 675, count: 1 },
    ]);
  });
});
