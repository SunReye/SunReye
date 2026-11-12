/// <reference types="bun" />
import { expect, test } from "bun:test";
import { controlGroups, summary, type ControlSetting, type Devices } from "./groups.ts";

function device(writes: boolean, settings: readonly ControlSetting[]): Devices[string] {
  return { writes, settings };
}

const charge = {
  key: "battery.max_charge_current",
  unit: "A",
  range: { min: 0, max: 190 },
  step: 1,
  enable: "on",
} as const;

const lock = {
  key: "battery.discharge_lock",
  values: [0, 1],
  labels: [
    { value: 0, text: "Unlocked" },
    { value: 1, text: "Locked" },
  ],
  step: 1,
  enable: "on",
} as const;

const work = { key: "work_mode", values: [0, 1, 2], step: 1, enable: "on" } as const;

const feed = {
  key: "grid.export_limit",
  unit: "W",
  range: { min: 0, max: 12000 },
  step: 100,
  enable: "off",
} as const;

test("settings group by their role namespace, the rest under Advanced, in a fixed order", () => {
  const groups = controlGroups({
    "1": device(true, [work, charge, feed, lock]),
    "2": device(false, [{ key: "limitSoc", range: { min: 0, max: 100 }, step: 1, enable: "on" }]),
    "3": device(true, []),
  });

  expect(groups.map((g) => [g.id, g.controls.map((c) => `${c.device} ${c.setting.key}`)])).toEqual([
    ["battery", ["1 battery.max_charge_current", "1 battery.discharge_lock"]],
    ["grid", ["1 grid.export_limit"]],
    ["advanced", ["1 work_mode", "2 limitSoc"]],
  ]);
});

test("a control writes only with its device's writes on and its setting verified or enabled", () => {
  const [battery, grid, advanced] = controlGroups({
    "1": device(true, [charge, feed]),
    "2": device(false, [work]),
  });

  expect([battery, grid, advanced].map((g) => g?.controls[0]?.writable)).toEqual([
    true,
    false,
    false,
  ]);
});

test("a group with no settings is left out", () => {
  expect(controlGroups({ "1": device(true, [work]) }).map((g) => g.id)).toEqual(["advanced"]);
});

test("a group's summary is its first two known values with their unit or label", () => {
  const [battery] = controlGroups({
    "1": device(true, [charge, lock, { ...charge, key: "battery.x" }]),
  });

  const values = new Map([
    ["1 battery.max_charge_current", 100],
    ["1 battery.discharge_lock", 1],
    ["1 battery.x", 5],
  ]);

  expect(summary(battery!, (c) => values.get(`${c.device} ${c.setting.key}`) ?? null, "en")).toBe(
    "100 A · Locked",
  );
  expect(summary(battery!, () => null, "en")).toBe("");
  expect(summary(battery!, (c) => (c.setting.key === "battery.x" ? 1500 : null), "de")).toBe(
    "1.500 A",
  );
});
