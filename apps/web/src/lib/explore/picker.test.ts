import { expect, test } from "bun:test";
import type { CatalogDevice } from "../api/core.ts";
import { PLANT, SPOT, TARIFF, WEATHER } from "../api/computed-devices.ts";
import { chipOf, pickerOf, searched } from "./picker.ts";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

const measured = (series: string, unit: string | null = "W") =>
  ({ series, unit, kind: "measurement", ...SPAN }) as const;

const CATALOG: readonly CatalogDevice[] = [
  { id: 2, name: "Zähler", removed: false, series: [measured("grid.phase.voltage[2]", "V")] },
  {
    id: 1,
    name: "Deye",
    removed: false,
    series: [
      measured("extra.Lüfter", "none"),
      measured("pv.mppt.power[2]"),
      measured("pv.power"),
      measured("pv.string.power[1]"),
      { series: "inverter.status", kind: "status", unit: null, ...SPAN },
      { series: "pv.energy.total", kind: "counter", unit: "kWh", ...SPAN },
      { series: "extra.code", kind: null, unit: null, ...SPAN },
    ],
  },
  { id: 5, name: "Alter Speicher", removed: true, series: [measured("battery.soc", "%")] },
  { id: 6, name: null, removed: true, series: [measured("battery.soc", "%")] },
  { id: WEATHER, name: null, removed: false, series: [measured("weather.ghi", "W/m²")] },
  { id: SPOT, name: null, removed: false, series: [measured("price.spot", "EUR/kWh")] },
  { id: TARIFF, name: null, removed: false, series: [measured("cost.savings.rate", "EUR/h")] },
  { id: PLANT, name: null, removed: false, series: [measured("pv.power"), measured("load.power")] },
];

const ESTIMATED = { "1": ["pv.string.power[1]"] };

const picker = pickerOf(CATALOG, ESTIMATED);

test("the plant comes first, then the registered devices by name, the computed ones and the weather", () => {
  expect(picker.map((d) => d.name)).toEqual([
    "Anlage",
    "Alter Speicher",
    "Deye",
    "Gerät 6",
    "Zähler",
    "Tarif",
    "Spotpreis",
    "Wetter",
  ]);
});

test("a removed device with history left is listed and marked", () => {
  expect(picker.filter((d) => d.removed).map((d) => d.id)).toEqual([5, 6]);
});

test("a device's series are grouped by role namespace, under the Readings' labels", () => {
  const deye = picker.find((d) => d.id === 1)!;

  expect(deye.groups.map((g) => [g.title, g.series.map((s) => s.label)])).toEqual([
    ["PV", ["Leistung", "Ertrag gesamt", "Eingang 2 · Leistung", "String 1 · Leistung"]],
    ["Wechselrichter", ["Betrieb"]],
    ["Extras", ["code", "Lüfter"]],
  ]);
});

test("an indexed series names its index: an MPPT input, a phase", () => {
  const phase = picker.find((d) => d.id === 2)!.groups[0]!.series[0]!;

  expect(phase.label).toBe("L2 · Spannung");
  expect(phase.ref).toEqual({ device: 2, series: "grid.phase.voltage[2]" });
});

test("an estimate carries its mark; a series says its unit, and none when it has none", () => {
  const [pv] = picker.find((d) => d.id === 1)!.groups;
  const string = pv!.series.find((s) => s.ref.series === "pv.string.power[1]")!;

  expect(string.estimated).toBe(true);
  expect(pv!.series[0]).toMatchObject({ estimated: false, unit: "W", kind: "measurement" });

  const extras = picker.find((d) => d.id === 1)!.groups.at(-1)!;

  expect(extras.series.map((s) => [s.unit, s.kind])).toEqual([
    [null, null],
    [null, "measurement"],
  ]);
});

test("extras are listed by their declared name in a group of their own, collapsed", () => {
  const groups = picker.find((d) => d.id === 1)!.groups;

  expect(groups.map((g) => g.collapsed)).toEqual([false, false, true]);
});

test("search filters every device by label, and opens the Extras it finds in", () => {
  const found = searched(picker, "lüft");

  expect(found.map((d) => d.name)).toEqual(["Deye"]);
  expect(found[0]!.groups).toMatchObject([{ title: "Extras", collapsed: false }]);
  expect(found[0]!.groups[0]!.series.map((s) => s.label)).toEqual(["Lüfter"]);
});

test("search filters by series id too", () => {
  const found = searched(picker, "MPPT.power");

  expect(found.flatMap((d) => d.groups.flatMap((g) => g.series.map((s) => s.ref.series)))).toEqual(
    ["pv.mppt.power[2]"],
  );
});

test("no search leaves the picker as it is", () => {
  expect(searched(picker, "  ")).toBe(picker);
});

test("a chip names its series and its device, without the catalog too", () => {
  expect(chipOf({ device: PLANT, series: "pv.power" }, [])).toEqual({
    label: "PV · Leistung",
    device: "Anlage",
    estimated: false,
    removed: false,
    unit: null,
  });
  expect(chipOf({ device: 5, series: "battery.soc" }, picker)).toEqual({
    label: "Batterie · Ladezustand",
    device: "Alter Speicher",
    estimated: false,
    removed: true,
    unit: "%",
  });
  expect(chipOf({ device: 9, series: "extra.fan" }, [])).toMatchObject({
    label: "fan",
    device: "Gerät 9",
  });
});
