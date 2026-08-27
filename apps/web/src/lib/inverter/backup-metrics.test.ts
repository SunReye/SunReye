import { describe, expect, test } from "bun:test";
import { backupSectionMetrics } from "./backup-metrics";
import type { CanonicalRole, ManifestMetric } from "$lib/inverter/types";

const metric = (key: string, group: string, role?: CanonicalRole): ManifestMetric =>
  ({ key, topic: key.replaceAll(".", "/"), label: key, unit: null, group, role }) as ManifestMetric;

describe("backupSectionMetrics", () => {
  test("prefers the metrics that meter the backup output itself", () => {
    const metrics = [
      metric("eps.power", "eps", "backup.power"),
      metric("eps.l1.voltage", "eps", "backup.phase.voltage"),
      metric("house.power", "load", "load.power"),
    ];
    expect(backupSectionMetrics(metrics).map((m) => m.key)).toEqual([
      "eps.power",
      "eps.l1.voltage",
    ]);
  });

  test("falls back to the load group when the output is not metered apart", () => {
    // A whole-home UPS: one set of registers is both the house load and the
    // backup output, so the section shows what the profile has — the section is
    // gated on the declared output, not on this list.
    const metrics = [
      metric("load.power", "load", "load.power"),
      metric("load.frequency", "load"),
      metric("battery.soc", "battery", "battery.soc"),
    ];
    expect(backupSectionMetrics(metrics).map((m) => m.key)).toEqual([
      "load.power",
      "load.frequency",
    ]);
  });

  test("no backup roles and no load group is an empty section, not a crash", () => {
    expect(backupSectionMetrics([metric("battery.soc", "battery", "battery.soc")])).toEqual([]);
  });

  test("an empty metric set yields nothing", () => {
    expect(backupSectionMetrics([])).toEqual([]);
  });
});
