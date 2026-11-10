import type { Frozen, Inverter, Quantity } from "../../packages/sdk/src/index.ts";
import { defineProfile } from "../../packages/sdk/src/index.ts";
import {
  BATTERY,
  CURRENTS,
  FLOWS,
  LOW_VOLTAGE,
  bounded,
  identify,
  inputs,
  settings,
  total,
} from "./shared.ts";

// The SUN-5K to SUN-20K-SG05LP3-EU-SM2 range: three-phase hybrids for a low-voltage battery. The
// register map is v4's official SG05LP3 profiles', the registers as Deye's three-phase protocol
// (MODBUS RTU 三相储能通信规约 V105) defines them. MPPT limits and AC ratings are from Deye's
// datasheets, the latest where an earlier one disagrees, so a forecast never caps below the
// hardware (ADR 5):
// - 5K to 12K, 2025-10: https://deye.com/wp-content/uploads/2025/10/sun-3-12k-sg05lp3-eu-sm2.pdf
//   (the 2024-09 sheet gives 20 A per input on the 8K to 12K:
//   https://www.deyeinverter.com/deyeinverter/2024/09/27/datasheet_sun-3-12k-sg05lp3-eu-sm2_240927_en.pdf)
// - 14K to 20K, 2026-07: https://deye.com/wp-content/uploads/2026/07/【b】datasheet_sun-14-20k-sg05lp3-eu-sm2_20260706_en.pdf
//   (the 2024-06 sheet gives 20 A on input 2:
//   https://www.deyeinverter.com/deyeinverter/2024/06/01/datasheet_sun-14-20k-sg05lp3-eu-sm2_240601_en.pdf)

/** One profile of the range: a model, or the whole family. */
export interface Model {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The PV inputs whose registers it reads, as v4 did: 2 up to 12 kW, 4 above. */
  readonly inputs: 2 | 4;
  /** Amperes: the bound of the battery current settings, from v4's profile of the model. */
  readonly current: number;
  /** From the datasheet, with the rated AC output. */
  readonly inverter: Frozen<Inverter> & { readonly acRating: number };
  /** Watts, as registers 20 and 21 report it; the family profile identifies by type alone. */
  readonly rated?: number;
}

const STATUS: readonly Frozen<Quantity>[] = [
  {
    key: "inverter.status",
    role: "extra.inverter_status",
    register: 500,
    type: "u16",
  },
  {
    key: "ac.relay_status",
    role: "extra.ac_relay_status",
    register: 552,
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
    key: "inverter.warning.1",
    role: "extra.inverter_warning_1",
    register: 553,
    type: "u16",
  },
  {
    key: "inverter.warning.2",
    role: "extra.inverter_warning_2",
    register: 554,
    type: "u16",
  },
  {
    key: "inverter.fault.1",
    role: "extra.inverter_fault_1",
    register: 555,
    type: "u16",
  },
  {
    key: "inverter.fault.2",
    role: "extra.inverter_fault_2",
    register: 556,
    type: "u16",
  },
  {
    key: "inverter.fault.3",
    role: "extra.inverter_fault_3",
    register: 557,
    type: "u16",
  },
  {
    key: "inverter.fault.4",
    role: "extra.inverter_fault_4",
    register: 558,
    type: "u16",
  },
];

const AC: readonly Frozen<Quantity>[] = [
  {
    key: "total_energy",
    role: "pv.energy.total",
    register: 534,
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
    key: "inverter.output.power",
    role: "inverter.power",
    register: 636,
    type: "i16",
  },
  {
    key: "ac.l1.ct.internal",
    role: "extra.ac_l1_ct_internal",
    register: 604,
    type: "i16",
  },
  {
    key: "ac.l2.ct.internal",
    role: "extra.ac_l2_ct_internal",
    register: 605,
    type: "i16",
  },
  {
    key: "ac.l3.ct.internal",
    role: "extra.ac_l3_ct_internal",
    register: 606,
    type: "i16",
  },
  {
    key: "ac.total_internal_power",
    role: "extra.ac_total_internal_power",
    register: 607,
    type: "i16",
  },
  {
    key: "ac.l1.ct.external",
    role: "grid.phase.power",
    index: 1,
    register: 616,
    type: "i16",
  },
  {
    key: "ac.l2.ct.external",
    role: "grid.phase.power",
    index: 2,
    register: 617,
    type: "i16",
  },
  {
    key: "ac.l3.ct.external",
    role: "grid.phase.power",
    index: 3,
    register: 618,
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
    key: "ac.l1.ct.internal_current",
    role: "extra.ac_l1_ct_internal_current",
    register: 610,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l1.ct.external_current",
    role: "grid.phase.current",
    index: 1,
    register: 613,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l2.ct.internal_current",
    role: "extra.ac_l2_ct_internal_current",
    register: 611,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l2.ct.external_current",
    role: "grid.phase.current",
    index: 2,
    register: 614,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l3.ct.internal_current",
    role: "extra.ac_l3_ct_internal_current",
    register: 612,
    type: "i16",
    scale: 0.01,
  },
  {
    key: "ac.l3.ct.external_current",
    role: "grid.phase.current",
    index: 3,
    register: 615,
    type: "i16",
    scale: 0.01,
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
    key: "battery.power",
    role: "battery.power",
    register: 590,
    type: "i16",
    scale: -1,
  },
  {
    key: "battery.voltage",
    role: "battery.voltage",
    register: 587,
    type: "u16",
    scale: 0.01,
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
    key: "battery.1.current",
    role: "extra.battery_1_current",
    register: 591,
    type: "i16",
    scale: -0.01,
  },
  {
    key: "battery.2.current",
    role: "extra.battery_2_current",
    register: 594,
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
    key: "battery.mode",
    role: "battery.mode",
    register: 98,
    type: "u16",
  },
  {
    key: "battery.2.soc",
    role: "extra.battery_2_soc",
    register: 589,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "battery.2.voltage",
    role: "extra.battery_2_voltage",
    register: 593,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "battery.2.power",
    role: "extra.battery_2_power",
    register: 595,
    type: "i16",
    scale: -1,
  },
  {
    key: "ac.generator.a.voltage",
    role: "extra.ac_generator_a_voltage",
    register: 661,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.generator.b.voltage",
    role: "extra.ac_generator_b_voltage",
    register: 662,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.generator.c.voltage",
    role: "extra.ac_generator_c_voltage",
    register: 663,
    type: "u16",
    scale: 0.1,
  },
  {
    key: "ac.generator.a.power",
    role: "extra.ac_generator_a_power",
    register: 664,
    type: "u16",
  },
  {
    key: "ac.generator.b.power",
    role: "extra.ac_generator_b_power",
    register: 665,
    type: "u16",
  },
  {
    key: "ac.generator.c.power",
    role: "extra.ac_generator_c_power",
    register: 666,
    type: "u16",
  },
  {
    key: "ac.generator.total_power",
    role: "generator.power",
    register: 667,
    type: "u16",
  },
  {
    key: "ac.generator.total_energy",
    role: "generator.energy.total",
    register: 537,
    type: "u32",
    scale: 0.1,
  },
  {
    key: "ac.generator.total_runtime",
    role: "extra.ac_generator_total_runtime",
    register: 512,
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
    key: "ac.ups.daily_energy",
    role: "extra.ac_ups_daily_energy",
    register: 526,
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
];

/** The settings registers, read as extras; the battery currents are bounded per model. */
const REGISTERS: readonly Frozen<Quantity>[] = [
  {
    key: "settings.battery.maximum_charge_current",
    role: "extra.settings_battery_maximum_charge_current",
    register: 108,
    type: "u16",
    range: {
      min: 0,
      max: 350,
    },
  },
  {
    key: "settings.battery.maximum_discharge_current",
    role: "extra.settings_battery_maximum_discharge_current",
    register: 109,
    type: "u16",
    range: {
      min: 0,
      max: 350,
    },
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
  },
  {
    key: "settings.solar_sell",
    role: "extra.settings_solar_sell",
    register: 145,
    type: "u16",
  },
  {
    key: "settings.battery.capacity",
    role: "extra.settings_battery_capacity",
    register: 102,
    type: "u16",
    range: {
      min: 0,
      max: 2000,
    },
  },
  {
    key: "settings.battery.shutdown_soc",
    role: "extra.settings_battery_shutdown_soc",
    register: 115,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "settings.battery.restart_soc",
    role: "extra.settings_battery_restart_soc",
    register: 116,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "settings.battery.low_soc",
    role: "extra.settings_battery_low_soc",
    register: 117,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "settings.battery.generator_charge_start_soc",
    role: "extra.settings_battery_generator_charge_start_soc",
    register: 124,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "settings.battery.generator_charge_current",
    role: "extra.settings_battery_generator_charge_current",
    register: 125,
    type: "u16",
  },
  {
    key: "settings.battery.grid_charge_start_soc",
    role: "extra.settings_battery_grid_charge_start_soc",
    register: 127,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "settings.battery.generator_charge",
    role: "extra.settings_battery_generator_charge",
    register: 129,
    type: "u16",
  },
  {
    key: "timeofuse.selling",
    role: "extra.timeofuse_selling",
    register: 146,
    type: "u16",
  },
  {
    key: "timeofuse.time.1",
    role: "extra.timeofuse_time_1",
    register: 148,
    type: "u16",
  },
  {
    key: "timeofuse.time.2",
    role: "extra.timeofuse_time_2",
    register: 149,
    type: "u16",
  },
  {
    key: "timeofuse.time.3",
    role: "extra.timeofuse_time_3",
    register: 150,
    type: "u16",
  },
  {
    key: "timeofuse.time.4",
    role: "extra.timeofuse_time_4",
    register: 151,
    type: "u16",
  },
  {
    key: "timeofuse.time.5",
    role: "extra.timeofuse_time_5",
    register: 152,
    type: "u16",
  },
  {
    key: "timeofuse.time.6",
    role: "extra.timeofuse_time_6",
    register: 153,
    type: "u16",
  },
  {
    key: "timeofuse.power.1",
    role: "extra.timeofuse_power_1",
    register: 154,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.power.2",
    role: "extra.timeofuse_power_2",
    register: 155,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.power.3",
    role: "extra.timeofuse_power_3",
    register: 156,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.power.4",
    role: "extra.timeofuse_power_4",
    register: 157,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.power.5",
    role: "extra.timeofuse_power_5",
    register: 158,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.power.6",
    role: "extra.timeofuse_power_6",
    register: 159,
    type: "u16",
    range: {
      min: 0,
      max: 20000,
    },
  },
  {
    key: "timeofuse.voltage.1",
    role: "extra.timeofuse_voltage_1",
    register: 160,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.voltage.2",
    role: "extra.timeofuse_voltage_2",
    register: 161,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.voltage.3",
    role: "extra.timeofuse_voltage_3",
    register: 162,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.voltage.4",
    role: "extra.timeofuse_voltage_4",
    register: 163,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.voltage.5",
    role: "extra.timeofuse_voltage_5",
    register: 164,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.voltage.6",
    role: "extra.timeofuse_voltage_6",
    register: 165,
    type: "u16",
    scale: 0.01,
  },
  {
    key: "timeofuse.soc.1",
    role: "extra.timeofuse_soc_1",
    register: 166,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.soc.2",
    role: "extra.timeofuse_soc_2",
    register: 167,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.soc.3",
    role: "extra.timeofuse_soc_3",
    register: 168,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.soc.4",
    role: "extra.timeofuse_soc_4",
    register: 169,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.soc.5",
    role: "extra.timeofuse_soc_5",
    register: 170,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.soc.6",
    role: "extra.timeofuse_soc_6",
    register: 171,
    type: "u16",
    range: {
      min: 0,
      max: 100,
    },
  },
  {
    key: "timeofuse.enabled.1",
    role: "extra.timeofuse_enabled_1",
    register: 172,
    type: "u16",
  },
  {
    key: "timeofuse.enabled.2",
    role: "extra.timeofuse_enabled_2",
    register: 173,
    type: "u16",
  },
  {
    key: "timeofuse.enabled.3",
    role: "extra.timeofuse_enabled_3",
    register: 174,
    type: "u16",
  },
  {
    key: "timeofuse.enabled.4",
    role: "extra.timeofuse_enabled_4",
    register: 175,
    type: "u16",
  },
  {
    key: "timeofuse.enabled.5",
    role: "extra.timeofuse_enabled_5",
    register: 176,
    type: "u16",
  },
  {
    key: "timeofuse.enabled.6",
    role: "extra.timeofuse_enabled_6",
    register: 177,
    type: "u16",
  },
];

export function sg05lp3(model: Model): Frozen<ReturnType<typeof defineProfile>> {
  return defineProfile({
    schema: 1,
    id: model.id,
    name: model.name,
    manufacturer: "Deye",
    version: model.version,
    requires: [
      "modbus",
      "u16",
      "i16",
      "u32",
      "compute",
      "write",
      "snapshot-toggle",
      "identify",
      "ac-rating",
      "setting-text",
    ],
    identify: identify(LOW_VOLTAGE, model.rated),
    inverter: model.inverter,
    quantities: [
      ...STATUS,
      ...inputs(model.inputs, 1),
      ...AC,
      ...bounded(REGISTERS, CURRENTS, model.current),
      total(model.inputs),
      BATTERY,
      ...FLOWS,
    ],
    settings: settings(model.current),
  });
}
