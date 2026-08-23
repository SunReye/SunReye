/**
 * A Shelly Pro 3EM authored as a profile — the falsification test for the
 * transport seam.
 *
 * Deliberately not an inverter: a three-phase energy meter with no register map,
 * no PV, no battery and nothing writable. If the profile model can only describe
 * inverters, or the `Binding` union can only describe registers, this is where it
 * shows — and it did not, which is the finding. Every metric below is a plain
 * `metric()` call with a `pointer` where an inverter profile has an `addr`.
 *
 * Wire format: Gen2 RPC over plain HTTP, `GET /rpc/Shelly.GetStatus`. On the HTTP
 * channel Shelly answers with the bare `result` object rather than a JSON-RPC
 * envelope, so pointers address the components directly with no `/result`
 * prefix. Field names, units and the sign convention come from the component
 * docs: https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM and
 * .../EMData. Active power is signed, positive = import; energy counters are two
 * separate unsigned Wh totals rather than one signed number, which is the shape
 * `grid.energy.imported/exported.total` already expects.
 *
 * Triphase mode only (`em:0` + `emdata:0`). The same hardware in monophase mode
 * exposes three independent `em1:*` components with flat keys and no
 * `total_act_power`, which is a second profile id rather than anything the
 * transport needs to know about.
 *
 * NOT YET HARDWARE-VERIFIED: the pointers are assembled from the per-component
 * documentation, not from a capture off a device. Take a real
 * `curl http://<ip>/rpc/Shelly.GetStatus` before publishing this to a profile
 * repo — a wrong component key yields absent metrics, which is correctly
 * indistinguishable from a device fault.
 */

import { defineProfile, metric } from "@SunReye/inverter-core";
import type { MetricDataDef } from "@SunReye/inverter-core";

/** `a`/`b`/`c` are the device's phase names; the roles are 1-based. */
const PHASES = [
  { letter: "a", index: 1 },
  { letter: "b", index: 2 },
  { letter: "c", index: 3 },
] as const;

const phaseMetrics = (): MetricDataDef[] =>
  PHASES.flatMap(({ letter, index }) => [
    metric(`grid/phase${index}/power`, {
      label: `Grid L${index} power`,
      group: "grid",
      unit: "W",
      pointer: `/em:0/${letter}_act_power`,
      role: "grid.phase.power",
      index,
      flow: { positive: "Import", negative: "Export" },
    }),
    metric(`grid/phase${index}/voltage`, {
      label: `Grid L${index} voltage`,
      group: "grid",
      unit: "V",
      pointer: `/em:0/${letter}_voltage`,
      role: "grid.phase.voltage",
      index,
    }),
    metric(`grid/phase${index}/current`, {
      label: `Grid L${index} current`,
      group: "grid",
      unit: "A",
      // The role is declared signed; this device reports a magnitude, with the
      // direction carried by the phase's power. Documented rather than worked
      // around — a per-role sign convention is not this profile's to invent.
      pointer: `/em:0/${letter}_current`,
      role: "grid.phase.current",
      index,
    }),
  ]);

export const shellyPro3em = defineProfile({
  id: "shelly-pro-3em",
  name: "Pro 3EM",
  manufacturer: "Shelly",
  version: "1.0.0",
  metrics: [
    metric("grid/power", {
      label: "Grid power",
      group: "grid",
      unit: "W",
      pointer: "/em:0/total_act_power",
      role: "grid.power",
      flow: { positive: "Import", negative: "Export" },
    }),
    ...phaseMetrics(),
    // Wh -> kWh. `scale` is the field the metric base already had for exactly
    // this; an API answering a different unit needs it as much as a register does.
    metric("grid/energy/imported/total", {
      label: "Grid imported",
      group: "grid",
      unit: "kWh",
      scale: 0.001,
      pointer: "/emdata:0/total_act",
      role: "grid.energy.imported.total",
    }),
    metric("grid/energy/exported/total", {
      label: "Grid exported",
      group: "grid",
      unit: "kWh",
      scale: 0.001,
      pointer: "/emdata:0/total_act_ret",
      role: "grid.energy.exported.total",
    }),
    // Unroled on purpose. The catalog has no frequency role, appending to it is
    // one-way, and one meter is not enough evidence to make that call — so it
    // ships as a plain measurement, which the manifest renders and the UI can
    // ignore. `kind` is explicit because there is no role to imply it.
    metric("grid/frequency", {
      label: "Grid frequency",
      group: "grid",
      unit: "Hz",
      pointer: "/em:0/a_freq",
      kind: "measurement",
    }),
  ],
});

/**
 * A `Shelly.GetStatus` body, trimmed to the components this profile reads.
 * Values are the documented examples, so the expected engineering values in the
 * tests can be derived by hand.
 */
export const shellyStatusBody = {
  "em:0": {
    id: 0,
    a_current: 4.029,
    a_voltage: 236.1,
    a_act_power: 951.2,
    a_aprt_power: 951.9,
    a_pf: 1,
    a_freq: 50,
    a_errors: [],
    b_current: 4.027,
    b_voltage: 236.201,
    b_act_power: -951.1,
    b_aprt_power: 951.8,
    b_pf: 1,
    b_freq: 50,
    c_current: 3.03,
    c_voltage: 236.402,
    c_act_power: 715.4,
    c_aprt_power: 716.2,
    c_pf: 1,
    c_freq: 50,
    n_current: 11.029,
    total_current: 11.083,
    total_act_power: 2484.782,
    total_aprt_power: 2486.7,
    errors: ["phase_sequence"],
  },
  "emdata:0": {
    id: 0,
    a_total_act_energy: 0,
    a_total_act_ret_energy: 0,
    total_act: 1_234_567,
    total_act_ret: 89_000,
  },
  sys: { unixtime: null },
} as const;
