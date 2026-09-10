/**
 * WHAT A DEVICE ROW SAYS UNDER ITS NAME.
 *
 * The shipped row led with the frozen slug — `evcc-loadpoint-1` — as the first
 * thing under "Carport". A slug is an identifier the operator never types, and
 * putting it on the primary surface is what made the card read as a dump of
 * database columns ("Carport / Charger / via MQTT / evcc-loadpoint-1 / EVCC
 * loadpoint / Unit 1"). Identifiers live on the detail page; the row keeps only
 * what tells two rows apart.
 *
 * A decision, not markup, so the rule can be stated once and checked: which
 * parts appear, in what order, and which of them is a fault rather than a fact.
 */

import { describe, expect, test } from "bun:test";
import { deviceMetaParts } from "./device-meta-parts";
import type { DeviceView } from "./device-types";

const device = (over: Partial<DeviceView> = {}): DeviceView => ({
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye",
  role: "inverter",
  unitId: 2,
  connectionId: 3,
  retiredAt: null,
  connection: null,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  battery: null,
  profileName: "Deye",
  profileKnown: true,
  kind: "modbus",
  state: "polling",
  integration: null,
  ...over,
});

const texts = (over: Partial<DeviceView> = {}) => deviceMetaParts(device(over)).map((p) => p.text);

describe("deviceMetaParts", () => {
  // The headline of the complaint: the slug is gone from the row entirely, on
  // every kind of device. Asserted as an absence over the whole part list
  // rather than by position, so a slug reintroduced anywhere in the line fails.
  test("the slug is never on the row, whatever the device is", () => {
    for (const kind of ["modbus", "coded", "virtual"] as const)
      expect(texts({ kind, slug: "evcc-loadpoint-1" }).join(" ")).not.toContain("evcc-loadpoint-1");
  });

  test("a Modbus device keeps its profile and the unit id it is addressed by", () => {
    expect(texts()).toEqual(["Deye", "Unit 2"]);
  });

  // A loadpoint's `unit_id` is its index in EVCC's config, not a slave address
  // on a wire, and nobody addresses it by that number: it was pure noise on the
  // primary surface. The detail page states it, where identifiers belong.
  test("a coded device shows no unit id — nothing addresses it by one", () => {
    expect(texts({ kind: "coded", profileName: "EVCC loadpoint" })).toEqual(["EVCC loadpoint"]);
  });

  test("an internal device shows no unit id either", () => {
    expect(texts({ kind: "virtual", profileName: "SunReye Optimizer" })).toEqual([
      "SunReye Optimizer",
    ]);
  });

  // A missing profile is a FAULT, not a fact — the device cannot be decoded —
  // so it keeps its raw id (that is what the operator has to install) and is
  // flagged for the row to paint it destructively.
  test("an uninstalled profile is flagged, and names the id that is missing", () => {
    const parts = deviceMetaParts(device({ profileKnown: false, profileId: "gone-profile" }));
    expect(parts[0]!.missing).toBe(true);
    expect(parts[0]!.text).toContain("gone-profile");
    expect(parts.slice(1).every((p) => !p.missing)).toBe(true);
  });

  // A profile the server knows but did not name still has to say something; the
  // id is the only honest answer, and it is not a fault.
  test("a known profile with no name falls back to its id, unflagged", () => {
    const parts = deviceMetaParts(device({ profileName: null }));
    expect(parts[0]).toEqual({ text: "deye", missing: false });
  });

  test("an inverter's roof and pack come after the addressing", () => {
    expect(
      texts({
        arrays: [
          { kwp: 8.4, tilt: 35, azimuth: 0 },
          { kwp: 3.15, tilt: 20, azimuth: 90 },
        ],
        battery: { usableKwh: 10, maxChargeW: 5000, minSoc: 10, nominalV: 51.2 },
      }),
    ).toEqual(["Deye", "Unit 2", "11.55 kWp", "10 kWh"]);
  });

  // Zero is not a roof. An array list summing to nothing renders no kWp part
  // rather than "0 kWp", which reads as a measurement.
  test("an empty roof and an absent pack add nothing", () => {
    expect(texts({ arrays: [{ kwp: 0, tilt: 0, azimuth: 0 }], battery: null })).toEqual([
      "Deye",
      "Unit 2",
    ]);
  });
});
