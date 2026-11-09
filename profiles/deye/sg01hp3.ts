import type { Frozen, Inverter, Quantity } from "../../packages/sdk/src/index.ts";
import { defineProfile } from "../../packages/sdk/src/index.ts";
import {
  CURRENTS as BATTERY_CURRENTS,
  FLOWS,
  HIGH_VOLTAGE,
  bounded,
  identify,
  inputs,
  settings,
  total,
} from "./shared.ts";

// The SUN-5K to SUN-25K-SG01HP3-EU-AM2 range: three-phase hybrids for a high-voltage battery. The
// register map is v4's official SG01HP3 profiles', which scale PV and battery power by 10; v4 read
// the inverter output registers 630 to 635 as grid phase values, which Deye's three-phase protocol
// (V105) defines as the inverter's, so they are extras here. Register 636, the inverter's output,
// is left out: no capture shows its scale on this range. MPPT limits and AC ratings, on which
// Deye's datasheet and product pages agree:
// - 2026-07: https://deye.com/wp-content/uploads/2026/07/【b】datasheet_sun-5-25k-sg01hp3-eu-am2_20260706_en.pdf
// - https://deye.com/product/sun-5-6-8-10-12-15-20-25k-sg01hp3-eu-am2/

/** One profile of the range: a model, or the whole family. */
export interface Model {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The PV inputs whose registers it reads, as v4 did: 2 up to 10 kW, 3 at 12 and 15, 4 above. */
  readonly inputs: 2 | 3 | 4;
  /** Amperes: the bound of the battery current settings, from v4's profile of the model. */
  readonly current: number;
  /** From the datasheet, with the rated AC output. */
  readonly inverter: Frozen<Inverter> & { readonly acRating: number };
  /** Watts, as registers 20 and 21 report it; the family profile identifies by type alone. */
  readonly rated?: number;
}

const REGISTERS: readonly Frozen<Quantity>[] = [
  {
    key: "total_energy",
    role: "pv.energy.total",
    register: 534,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "battery.soc",
    role: "battery.soc",
    register: 588,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "battery.power",
    role: "battery.power",
    register: 590,
    type: "i16",
    scale: -10,
  },
  {
    key: "battery.voltage",
    role: "battery.voltage",
    register: 587,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "battery.current",
    role: "battery.current",
    register: 591,
    type: "i16",
    scale: -0.01,
  },
  {
    key: "battery.temperature",
    role: "battery.temperature",
    register: 586,
    type: "u16",
    scale: 0.1,
    offset: -100,
  },
  {
    key: "battery.total_charge",
    role: "battery.energy.charged.total",
    register: 516,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "battery.total_discharge",
    role: "battery.energy.discharged.total",
    register: 518,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "ac.total_power",
    role: "grid.power",
    register: 625,
    type: "i16",
  },
  {
    key: "ac.l1.voltage",
    role: "grid.phase.voltage",
    index: 1,
    register: 598,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.l2.voltage",
    role: "grid.phase.voltage",
    index: 2,
    register: 599,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.l3.voltage",
    role: "grid.phase.voltage",
    index: 3,
    register: 600,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.l1.current",
    role: "extra.ac_l1_current",
    register: 630,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l2.current",
    role: "extra.ac_l2_current",
    register: 631,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l3.current",
    role: "extra.ac_l3_current",
    register: 632,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l1.power",
    role: "extra.ac_l1_power",
    register: 633,
    type: "i16",
  },
  {
    key: "ac.l2.power",
    role: "extra.ac_l2_power",
    register: 634,
    type: "i16",
  },
  {
    key: "ac.l3.power",
    role: "extra.ac_l3_power",
    register: 635,
    type: "i16",
  },
  {
    key: "ac.total_energy_bought",
    role: "grid.energy.imported.total",
    register: 522,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "ac.total_energy_sold",
    role: "grid.energy.exported.total",
    register: 524,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "ac.ups.total_power",
    role: "load.power",
    register: 653,
    type: "i16",
  },
  {
    key: "ac.ups.l1.power",
    role: "extra.ac_ups_l1_power",
    register: 650,
    type: "i16",
  },
  {
    key: "ac.ups.l2.power",
    role: "extra.ac_ups_l2_power",
    register: 651,
    type: "i16",
  },
  {
    key: "ac.ups.l3.power",
    role: "extra.ac_ups_l3_power",
    register: 652,
    type: "i16",
  },
  {
    key: "ac.ups.l1.voltage",
    role: "extra.ac_ups_l1_voltage",
    register: 644,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.ups.l2.voltage",
    role: "extra.ac_ups_l2_voltage",
    register: 645,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.ups.l3.voltage",
    role: "extra.ac_ups_l3_voltage",
    register: 646,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.ups.total_energy",
    role: "load.energy.total",
    register: 527,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "ac.generator.total_power",
    role: "generator.power",
    register: 667,
    type: "i16",
  },
  {
    key: "ac.generator.l1.power",
    role: "extra.ac_generator_l1_power",
    register: 664,
    type: "i16",
  },
  {
    key: "ac.generator.l2.power",
    role: "extra.ac_generator_l2_power",
    register: 665,
    type: "i16",
  },
  {
    key: "ac.generator.l3.power",
    role: "extra.ac_generator_l3_power",
    register: 666,
    type: "i16",
  },
  {
    key: "ac.generator.l1.voltage",
    role: "extra.ac_generator_l1_voltage",
    register: 661,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.generator.l2.voltage",
    role: "extra.ac_generator_l2_voltage",
    register: 662,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.generator.l3.voltage",
    role: "extra.ac_generator_l3_voltage",
    register: 663,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "inverter.status",
    role: "extra.inverter_status",
    register: 500,
    type: "u16",
  },
  {
    key: "radiator_temp",
    role: "extra.radiator_temp",
    register: 540,
    type: "i16",
    scale: 0.1,
    offset: -100,
  },
  {
    key: "ac.temperature",
    role: "extra.ac_temperature",
    register: 541,
    type: "i16",
    scale: 0.1,
    offset: -100,
  },
  {
    key: "battery.mode",
    role: "battery.mode",
    register: 98,
    type: "u16",
  },
];

/** The settings registers, read as extras; bounded per model as v4 bounded them. */
const SETTINGS: readonly Frozen<Quantity>[] = [
  {
    key: "settings.battery.maximum_charge_current",
    role: "extra.settings_battery_maximum_charge_current",
    register: 108,
    type: "u16",
  },
  {
    key: "settings.battery.maximum_discharge_current",
    role: "extra.settings_battery_maximum_discharge_current",
    register: 109,
    type: "u16",
  },
  {
    key: "settings.battery.maximum_grid_charge_current",
    role: "extra.settings_battery_maximum_grid_charge_current",
    register: 128,
    type: "u16",
  },
  {
    key: "settings.battery.grid_charge",
    role: "extra.settings_battery_grid_charge",
    register: 130,
    type: "u16",
  },
  {
    key: "settings.workmode",
    role: "extra.settings_workmode",
    register: 142,
    type: "u16",
  },
  {
    key: "settings.solar_sell_max_power",
    role: "extra.settings_solar_sell_max_power",
    register: 143,
    type: "u16",
    scale: 10,
  },
  {
    key: "settings.solar_sell",
    role: "extra.settings_solar_sell",
    register: 145,
    type: "u16",
  },
];

/** The battery current registers' extras, bounded by the model's battery current. */
const CURRENTS = [...BATTERY_CURRENTS, "settings.battery.maximum_grid_charge_current"];

/** The export limit's extra, bounded by the model's rated power. */
const EXPORT = ["settings.solar_sell_max_power"];

export function sg01hp3(model: Model): Frozen<ReturnType<typeof defineProfile>> {
  return defineProfile({
    schema: 1,
    id: model.id,
    name: model.name,
    manufacturer: "Deye",
    version: model.version,
    requires: ["modbus", "u16", "i16", "u32", "compute", "write", "snapshot-toggle"],
    identify: identify(HIGH_VOLTAGE, model.rated),
    inverter: model.inverter,
    quantities: [
      ...inputs(model.inputs, 10),
      ...REGISTERS,
      ...bounded(bounded(SETTINGS, CURRENTS, model.current), EXPORT, model.inverter.acRating),
      total(model.inputs),
      ...FLOWS,
    ],
    settings: settings(model.current),
  });
}
