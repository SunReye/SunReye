/**
 * The loadpoint registrar: EVCC's snapshot -> device rows -> the ONE wired
 * writer.
 *
 * Doubles for every dependency, because what is under test is the ORDER and the
 * lifecycle — a row before a commit, one reload per new loadpoint, a retire that
 * writes out what it held — and none of that is a statement about Postgres. The
 * statement about Postgres is `apps/server/db-tests/evcc-loadpoint-history.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { EvccLoadpoint } from "@SunReye/contracts/evcc";
import { type DeviceInstance, deviceInstance } from "@SunReye/inverter-core";

import type { DeviceSample } from "../inverter/device-writer";
import { LOADPOINT_METRICS } from "./evcc-devices";
import { createLoadpointRegistrar } from "./evcc-registrar";

function loadpoint(index: number, overrides: Partial<EvccLoadpoint> = {}): EvccLoadpoint {
  return {
    index,
    title: `Loadpoint ${index}`,
    mode: "pv",
    chargePower: 0,
    chargePowerLive: 0,
    chargePowerSource: "measured",
    charging: false,
    connected: false,
    vehicleSoc: null,
    vehicleRange: null,
    vehicleTitle: null,
    vehicleName: null,
    sessionEnergy: null,
    chargeRemainingEnergy: null,
    limitSoc: null,
    effectiveLimitSoc: null,
    vehicleLimitSoc: null,
    batteryBoost: false,
    batteryBoostLimit: null,
    vehicleCapacityKwh: null,
    phasesActive: null,
    ...overrides,
  };
}

const T0 = new Date("2026-08-30T12:00:00.000Z");

/** A registrar over recorded doubles, with a roster that fills as rows appear. */
function registrarOver(options: { ensureFails?: boolean; rosterStaysEmpty?: boolean } = {}) {
  const calls: string[] = [];
  const rows = new Set<string>();
  const committed: { id: string; sample: DeviceSample }[] = [];
  const forgotten: string[] = [];
  const warnings: string[] = [];
  const instances = new Map<string, DeviceInstance>();

  const registrar = createLoadpointRegistrar({
    async ensureDevice(id, index, title) {
      calls.push(`ensure:${id}:${index}:${title ?? ""}`);
      if (options.ensureFails) throw new Error("no plant yet");
      rows.add(id);
      return true;
    },
    async reloadRegistry() {
      calls.push("reload");
      if (options.rosterStaysEmpty) return;
      for (const id of rows) {
        instances.set(
          id,
          deviceInstance({
            id,
            deviceClass: "charger",
            integration: "evcc",
            metrics: LOADPOINT_METRICS,
          }),
        );
      }
    },
    device: (id) => instances.get(id),
    commit: (device, sample) => void committed.push({ id: device.id, sample }),
    forgetDevice: (id) => void forgotten.push(id),
    logger: { warn: (template) => void warnings.push(template) },
  });

  return { registrar, calls, committed, forgotten, warnings };
}

describe("EVCC's loadpoints become devices with history", () => {
  test("one source with two loadpoints registers two devices, each with its own id", async () => {
    const { registrar, committed } = registrarOver();
    await registrar.sync([loadpoint(1), loadpoint(2)], T0);

    expect(committed.map((c) => c.id)).toEqual(["evcc-loadpoint-1", "evcc-loadpoint-2"]);
  });

  test("the row exists before anything is committed for it", async () => {
    // `metrics_raw.device_id` is a NOT NULL foreign key, and the write path
    // DROPS rows naming a device with no row rather than failing the batch — so
    // a commit that beat its row would lose readings in silence.
    const { registrar, calls } = registrarOver();
    await registrar.sync([loadpoint(1)], T0);

    expect(calls).toEqual(["ensure:evcc-loadpoint-1:1:Loadpoint 1", "reload"]);
  });

  test("a steady roster costs one reload, not one per snapshot", async () => {
    const { registrar, calls, committed } = registrarOver();
    await registrar.sync([loadpoint(1)], T0);
    await registrar.sync([loadpoint(1)], T0);
    await registrar.sync([loadpoint(1)], T0);

    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
    expect(committed).toHaveLength(3);
  });

  test("charge power lands in the sample the seam is handed", async () => {
    const { registrar, committed } = registrarOver();
    await registrar.sync(
      [loadpoint(1, { chargePower: 7200, chargePowerLive: 7200, connected: true, charging: true })],
      T0,
    );

    expect(committed[0]?.sample).toEqual({
      time: T0,
      metrics: {
        "ev.charge.power": 7200,
        "ev.connected": 1,
        "ev.charging": 1,
      },
      provenance: { "ev.charge.power": "measured" },
    });
  });

  test("overlapping snapshots do not register the same loadpoint twice", async () => {
    // The ingest fires one of these per coalesced burst and never awaits it, so
    // a second snapshot can arrive while the first is still inside its device
    // round trip. Without a guard both would see an empty roster and both would
    // ensure — and then reload — the same rows.
    const { registrar, calls } = registrarOver();
    await Promise.all([
      registrar.sync([loadpoint(1)], T0),
      registrar.sync([loadpoint(1)], T0),
      registrar.sync([loadpoint(1)], T0),
    ]);

    expect(calls.filter((c) => c.startsWith("ensure:"))).toEqual([
      "ensure:evcc-loadpoint-1:1:Loadpoint 1",
    ]);
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("zero loadpoints registers nothing and commits nothing", async () => {
    const { registrar, calls, committed, forgotten } = registrarOver();
    await registrar.sync([], T0);

    expect(calls).toEqual([]);
    expect(committed).toEqual([]);
    expect(forgotten).toEqual([]);
  });

  test("a loadpoint that disappears between polls is forgotten, the others are not", async () => {
    const { registrar, forgotten, committed } = registrarOver();
    await registrar.sync([loadpoint(1), loadpoint(2)], T0);
    committed.length = 0;
    await registrar.sync([loadpoint(1)], T0);

    // Its open intervals are written out by the seam; nothing after this moment
    // is keyed to it.
    expect(forgotten).toEqual(["evcc-loadpoint-2"]);
    expect(committed.map((c) => c.id)).toEqual(["evcc-loadpoint-1"]);
  });

  test("a loadpoint that comes back is registered again", async () => {
    const { registrar, committed } = registrarOver();
    await registrar.sync([loadpoint(1), loadpoint(2)], T0);
    await registrar.sync([loadpoint(1)], T0);
    committed.length = 0;
    await registrar.sync([loadpoint(1), loadpoint(2)], T0);

    expect(committed.map((c) => c.id)).toEqual(["evcc-loadpoint-1", "evcc-loadpoint-2"]);
  });

  test("EVCC going quiet is not a retirement", async () => {
    // `reachable: false` (the broker dropped, or EVCC's LWT fired) empties the
    // snapshot. That is a lost connection, not an operator removing a charger,
    // and retiring the device would close its intervals on every hiccup.
    const { registrar, forgotten } = registrarOver();
    await registrar.sync([loadpoint(1)], T0);
    registrar.suspend();

    expect(forgotten).toEqual([]);
  });

  test("a plant with no rows yet warns once and keeps ingesting", async () => {
    // EVCC ingest starts even in onboarding-only boot, before any plant exists.
    // A throwing registration must not take the live feed down with it.
    const { registrar, committed, warnings } = registrarOver({ ensureFails: true });
    await registrar.sync([loadpoint(1)], T0);
    await registrar.sync([loadpoint(1)], T0);

    expect(committed).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test("a device the registry has not resolved yet is not committed to", async () => {
    // Belt over the ordering above: with no instance there is no metric list, so
    // a commit would route an undeclared key through a policy built from
    // nothing. The plant's rows are re-read by a reload this registrar does not
    // own, so "the row was written but the roster has not caught up" is a state
    // that can genuinely occur.
    const { registrar, committed } = registrarOver({ rosterStaysEmpty: true });
    await registrar.sync([loadpoint(1)], T0);
    expect(committed).toEqual([]);
  });

  test("a suspended registrar registers the roster again on the next snapshot", async () => {
    const { registrar, calls } = registrarOver();
    await registrar.sync([loadpoint(1)], T0);
    registrar.suspend();
    await registrar.sync([loadpoint(1)], T0);

    expect(calls.filter((c) => c === "reload")).toHaveLength(2);
  });
});
