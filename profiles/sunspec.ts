import { defineProfile } from "../packages/sdk/src/index.ts";
import type { Quantity } from "../packages/sdk/src/index.ts";

// The generic SunSpec profile (ADR 5): the standard models a conforming device holds, mapped to
// roles. Offsets count from a model's ID register, as the SunSpec model definitions lay a model
// out: https://github.com/sunspec/models json/model_<id>.json at commit 90b4a331dcca1d6eac69c1bead952fddcc5852e0.
// 101, 102 and 103 share one layout, as do the meters 201 to 204.
//
// The models state no sign for a meter's or a battery's power. EVCC's generic SunSpec templates
// read a meter's `W` unscaled as grid power, positive when importing, and Kostal's `802:W` unscaled
// as battery power, positive when discharging
// (https://github.com/evcc-io/evcc templates/definition/meter/sunspec-meter.yaml and
// kostal-plenticore-gen2.yaml at commit 5837de377310c57a6f717600b232cb03efc5d071), so the battery's
// power and current are negated to charge positive (ADR 4).
const INVERTER = [101, 102, 103];
const MPPT = [160];
const METER = [201, 202, 203, 204];
const BATTERY = [802];

/** Model 160 repeats a module of 20 registers from offset 10; a device declares how many. */
const MODULES = 4;
const MODULE = 20;

const PHASES = [1, 2, 3];

function mppt(input: number): Quantity[] {
  const at = 10 + MODULE * (input - 1);
  const point = { index: input, model: MPPT, type: "u16" } as const;

  return [
    {
      ...point,
      key: `mppt${input}Current`,
      role: "pv.mppt.current",
      register: at + 9,
      scaleFactor: 2,
      resolution: 0.001,
    },
    {
      ...point,
      key: `mppt${input}Voltage`,
      role: "pv.mppt.voltage",
      register: at + 10,
      scaleFactor: 3,
      resolution: 0.01,
    },
    {
      ...point,
      key: `mppt${input}Power`,
      role: "pv.mppt.power",
      register: at + 11,
      scaleFactor: 4,
      resolution: 0.01,
    },
  ];
}

export default defineProfile({
  schema: 1,
  id: "sunspec",
  name: "SunSpec device",
  manufacturer: "SunSpec",
  version: "1.0.0",
  requires: ["sunspec", "u16", "i16", "acc32", "scale-factor"],
  quantities: [
    {
      key: "acPower",
      role: "pv.power",
      model: INVERTER,
      register: 14,
      type: "i16",
      scaleFactor: 15,
      resolution: 0.01,
    },
    {
      key: "acEnergy",
      role: "pv.energy.total",
      model: INVERTER,
      register: 24,
      type: "acc32",
      scale: 0.001,
      scaleFactor: 26,
      resolution: 0.000_001,
    },
    {
      key: "frequency",
      role: "grid.frequency",
      model: INVERTER,
      register: 16,
      type: "u16",
      scaleFactor: 17,
      resolution: 0.001,
    },
    ...PHASES.map((phase) => ({
      key: `phase${phase}Voltage`,
      role: "grid.phase.voltage",
      index: phase,
      model: INVERTER,
      register: 9 + phase,
      type: "u16" as const,
      scaleFactor: 13,
      resolution: 0.01,
    })),
    ...Array.from({ length: MODULES }, (_, i) => mppt(i + 1)).flat(),
    {
      key: "gridPower",
      role: "grid.power",
      model: METER,
      register: 18,
      type: "i16",
      scaleFactor: 22,
      resolution: 0.01,
    },
    ...PHASES.flatMap((phase) => [
      {
        key: `gridPhase${phase}Power`,
        role: "grid.phase.power",
        index: phase,
        model: METER,
        register: 18 + phase,
        type: "i16" as const,
        scaleFactor: 22,
        resolution: 0.01,
      },
      {
        key: `gridPhase${phase}Current`,
        role: "grid.phase.current",
        index: phase,
        model: METER,
        register: 2 + phase,
        type: "i16" as const,
        scaleFactor: 6,
        resolution: 0.001,
      },
    ]),
    {
      key: "gridExported",
      role: "grid.energy.exported.total",
      model: METER,
      register: 38,
      type: "acc32",
      scale: 0.001,
      scaleFactor: 54,
      resolution: 0.000_001,
    },
    {
      key: "gridImported",
      role: "grid.energy.imported.total",
      model: METER,
      register: 46,
      type: "acc32",
      scale: 0.001,
      scaleFactor: 54,
      resolution: 0.000_001,
    },
    {
      key: "batterySoc",
      role: "battery.soc",
      model: BATTERY,
      register: 11,
      type: "u16",
      scaleFactor: 56,
      resolution: 0.01,
    },
    {
      key: "batteryCapacity",
      role: "battery.capacity",
      model: BATTERY,
      register: 3,
      type: "u16",
      scale: 0.001,
      scaleFactor: 53,
      resolution: 0.000_1,
    },
    {
      key: "batteryVoltage",
      role: "battery.voltage",
      model: BATTERY,
      register: 34,
      type: "u16",
      scaleFactor: 59,
      resolution: 0.01,
    },
    {
      key: "batteryCurrent",
      role: "battery.current",
      model: BATTERY,
      register: 44,
      type: "i16",
      scale: -1,
      scaleFactor: 61,
      resolution: 0.001,
    },
    {
      key: "batteryPower",
      role: "battery.power",
      model: BATTERY,
      register: 47,
      type: "i16",
      scale: -1,
      scaleFactor: 63,
      resolution: 0.01,
    },
  ],
});
