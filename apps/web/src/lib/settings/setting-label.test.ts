/// <reference types="bun" />
import { expect, test } from "bun:test";
import { settingLabel } from "./setting-label.ts";

test("a known role reads in the viewer's language", () => {
  expect(
    settingLabel({ key: "battery.max_charge_current", name: "Max battery charge current" }),
  ).toBe("Max. Ladestrom");
  expect(settingLabel({ key: "battery.time_of_use.3.soc", name: "Slot 3 SOC target" })).toBe(
    "Zeitfenster 3: Ziel-SOC",
  );
});

test("an unknown key reads as the profile names it", () => {
  expect(settingLabel({ key: "pv.export_mode", name: "Export mode" })).toBe("Export mode");
});

test("a key the profile does not name still never shows as a key", () => {
  for (const key of ["limitSoc", "inverter.reactive_power_mode", "x.y_z"]) {
    const label = settingLabel({ key });

    expect(label).not.toBe(key);
    expect(label).not.toMatch(/[._]/u);
  }

  expect(settingLabel({ key: "inverter.reactive_power_mode" })).toBe(
    "Inverter reactive power mode",
  );
});
