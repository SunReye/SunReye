import type { Frozen, Identify, Quantity, Setting } from "../../packages/sdk/src/index.ts";

// What Deye's SG05LP3 and SG01HP3 ranges share: the registers of Deye's three-phase protocol
// (MODBUS RTU 三相储能通信规约 V105, https://download.axilogi.com/DEYE/Other/MODBUS_RTU.pdf).

/** Register 0, the device type, of a three-phase hybrid for a low-voltage battery. */
export const LOW_VOLTAGE = [0x0500];

/** Register 0 of a three-phase hybrid for a high-voltage battery: 6 to 15 kW, then 20 to 50 kW. */
export const HIGH_VOLTAGE = [0x0600, 0x0601];

/** The device type, and the rated power in registers 20 and 21 (0.1 W, low word first). */
export function identify(types: readonly number[], rated?: number): Frozen<Identify>[] {
  const type = { register: 0, values: types };

  return rated === undefined ? [type] : [type, { register: 20, type: "u32", values: [rated * 10] }];
}

/** PV input `n`'s power, voltage and current registers; the high-voltage range scales power by 10. */
function input(n: number, power: number): Frozen<Quantity>[] {
  const point = { index: n, type: "u16" } as const;
  const watts = power === 1 ? {} : { scale: power };

  return [
    { key: `dc.pv${n}.power`, role: "pv.mppt.power", register: 671 + n, ...watts, ...point },
    {
      key: `dc.pv${n}.voltage`,
      role: "pv.mppt.voltage",
      register: 674 + 2 * n,
      scale: 0.1,
      ...point,
    },
    {
      key: `dc.pv${n}.current`,
      role: "pv.mppt.current",
      register: 675 + 2 * n,
      scale: 0.1,
      ...point,
    },
  ];
}

/** The first `count` PV inputs. */
export function inputs(count: number, power: number): Frozen<Quantity>[] {
  return Array.from({ length: count }, (_, i) => input(i + 1, power)).flat();
}

/** The PV power: the sum of the first `count` inputs. */
export function total(count: number): Frozen<Quantity> {
  return {
    key: "dc.total_power",
    role: "pv.power",
    compute: { sum: Array.from({ length: count }, (_, i) => `dc.pv${i + 1}.power`) },
  };
}

/** The battery current of the low-voltage range: its two battery inputs' sum. */
export const BATTERY: Frozen<Quantity> = {
  key: "battery.current",
  role: "battery.current",
  compute: {
    sum: ["battery.1.current", "battery.2.current"],
  },
};

/** Power flows derived from grid, battery, PV and load power, as v4 derived them. */
export const FLOWS: readonly Frozen<Quantity>[] = [
  {
    key: "grid.import_power",
    role: "extra.grid_import_power",
    compute: {
      clamp: {
        key: "ac.total_power",
        min: 0,
      },
    },
  },
  {
    key: "grid.export_power",
    role: "extra.grid_export_power",
    compute: {
      diff: ["grid.import_power", "ac.total_power"],
    },
  },
  {
    key: "battery.charge_power",
    role: "extra.battery_charge_power",
    compute: {
      clamp: {
        key: "battery.power",
        min: 0,
      },
    },
  },
  {
    key: "battery.discharge_power",
    role: "extra.battery_discharge_power",
    compute: {
      diff: ["battery.charge_power", "battery.power"],
    },
  },
  {
    key: "inverter.power",
    role: "extra.inverter_power",
    compute: {
      combine: {
        add: ["dc.total_power", "ac.total_power"],
        sub: ["battery.power", "ac.ups.total_power"],
      },
    },
  },
  {
    key: "inverter.efficiency",
    role: "extra.inverter_efficiency",
    compute: {
      ratio: {
        num: ["ac.ups.total_power", "battery.charge_power", "grid.export_power"],
        den: ["dc.total_power", "battery.discharge_power", "grid.import_power"],
        scale: 100,
      },
    },
    range: {
      min: 0,
      max: 100,
    },
  },
];

/** The settings, each written with function code 16 and read back from its register. */
const SETTINGS: readonly Frozen<Setting>[] = [
  {
    key: "battery.max_charge_current",
    name: "Max battery charge current",
    unit: "A",
    type: "u16",
    range: {
      min: 0,
      max: 350,
    },
    minInterval: 60,
    recipe: [
      {
        write: {
          register: 108,
        },
      },
    ],
    readBack: {
      register: 108,
    },
  },
  {
    key: "battery.max_discharge_current",
    name: "Max battery discharge current",
    unit: "A",
    type: "u16",
    range: {
      min: 0,
      max: 350,
    },
    minInterval: 60,
    recipe: [
      {
        write: {
          register: 109,
        },
      },
    ],
    readBack: {
      register: 109,
    },
  },
  {
    key: "battery.grid_charge",
    name: "Grid charge",
    labels: {
      0: "Off",
      1: "On",
    },
    type: "u16",
    values: [0, 1],
    minInterval: 60,
    recipe: [
      {
        write: {
          register: 130,
        },
      },
    ],
    readBack: {
      register: 130,
    },
  },
  {
    key: "work_mode",
    name: "Work mode",
    labels: {
      0: "Selling first",
      1: "Zero export to load",
      2: "Zero export to CT",
    },
    type: "u16",
    values: [0, 1, 2],
    minInterval: 60,
    recipe: [
      {
        write: {
          register: 142,
        },
      },
    ],
    readBack: {
      register: 142,
    },
  },
  {
    key: "battery.discharge_lock",
    name: "Battery discharge lock",
    labels: {
      0: "Unlocked",
      1: "Locked",
    },
    type: "u16",
    values: [0, 1],
    minInterval: 60,
    recipe: [
      {
        snapshotToggle: {
          target: "battery.max_discharge_current",
          locked: 0,
        },
      },
    ],
  },
];

/** The battery current registers' extras, bounded per model. */
export const CURRENTS: readonly string[] = [
  "settings.battery.maximum_charge_current",
  "settings.battery.maximum_discharge_current",
];

/** `item` bounded from 0 to `max`. */
function upTo<T extends object>(
  item: Readonly<T>,
  max: number,
): Readonly<T> & Frozen<{ range: { min: number; max: number } }> {
  return { ...item, range: { min: 0, max } };
}

/** `quantities` with those of `keys` bounded from 0 to `max`. */
export function bounded(
  quantities: readonly Frozen<Quantity>[],
  keys: readonly string[],
  max: number,
): Frozen<Quantity>[] {
  return quantities.map((q) => (keys.includes(q.key) ? upTo(q, max) : q));
}

/** The settings, the battery currents bounded by `current` amperes. */
export function settings(current: number): Frozen<Setting>[] {
  return SETTINGS.map((s) => (s.key.endsWith("_current") ? upTo(s, current) : s));
}
