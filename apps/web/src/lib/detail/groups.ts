// What each kind of node lists in its sheet (ADR 21), grouped: Jetzt, MPPT inputs or phases as
// tables, Zustand, Zähler. v3's node dialogs on v5's roles (ADR 4):
//
//   pv.total.power                      pv.power
//   pv.string.power                     pv.string.power, an estimate unless alone on its input (ADR 17)
//   pv.string.voltage / .current        pv.mppt.voltage / .current: v5 measures the input
//   production.total                    pv.energy.total
//   inverter.efficiency                 inverter.efficiency, hidden while it reads 0
//   inverter.power (self-consumption)   inverter.loss.power
//   inverter.status, .temperature.*     inverter.status, inverter.temperature (the hottest sensor)
//   load.phase.*                        load.phase.power
//   battery.*, grid.*, load.*           same names; battery.cycles is the vendor's count
//   EVCC loadpoint fields               ev.charge.power, ev.vehicle.soc, ev.limit.soc,
//                                       ev.session.energy, ev.connected, ev.charging, ev.mode,
//                                       ev.battery.boost
//
// Not shown: battery.mode, a raw vendor code ADR 4 gives no values for, and every "*.today"
// counter (ADR 4: days come from rollups).
import { m } from "../paraglide/messages.js";
import { consumers, type MeasurementPoint } from "./consumers.ts";
import { formatFigure } from "./figures.ts";
import { kept, table, tabled, type Group, type Reader } from "./rows.ts";

/** A layout string: the `pv.string.power` index, its MPPT input and inverter. */
export interface PvString {
  readonly id: number;
  readonly name: string;
  readonly input: number;
  readonly device: number;
}

/** A power in W: the sheet writes it in the shared power format (W below 1 kW). */
const POWER = { unit: "W", digits: 0 };
const MWH = { unit: "MWh", scale: 0.001 };

export function inputs(read: Reader): Group {
  return tabled(
    m.rd_inputs(),
    table(read, (i) => m.rd_input({ n: i }), [
      { role: "pv.mppt.voltage", label: m.rd_voltage(), unit: "V", digits: 0 },
      { role: "pv.mppt.current", label: m.rd_current(), unit: "A", digits: 1 },
      { role: "pv.mppt.power", label: m.rd_power(), ...POWER },
    ]),
  );
}

export const pvTotal = (read: Reader): Group => ({
  title: m.rd_counters(),
  rows: kept([read.num("pv.energy.total", { label: m.rd_pv_total(), ...MWH, digits: 1 })]),
});

/** The share of its input a parallel string's estimate takes, in %. */
function share(read: Reader, input: number, id: number): number | null {
  const all = read.raw(`pv.mppt.power[${input}]`);
  const own = read.raw(`pv.string.power[${id}]`);

  return all !== undefined && own !== undefined && all > 0 ? (own / all) * 100 : null;
}

export function string(read: Reader, strings: readonly PvString[], id: number): Group[] {
  const self = strings.find((s) => s.id === id);

  if (self === undefined) return [];

  const i = self.input;
  const on = strings.filter((s) => s.input === i && s.device === self.device);
  const alone = on.length === 1;
  const part = alone ? null : share(read, i, id);
  const label = m.rd_share({ n: i });

  return [
    {
      title: m.rd_now(),
      ...(!alone && { note: m.rd_shared_note({ input: i, count: on.length }) }),
      rows:
        part === null
          ? []
          : [{ key: "share", label, value: part, unit: "%", digits: 0, est: true }],
    },
    {
      title: m.rd_input_title({ n: i }),
      // A string alone on its input is the input: its power is the sheet's figure already.
      rows: kept([
        alone ? null : read.num(`pv.mppt.power[${i}]`, { label: m.rd_power(), ...POWER }),
        read.num(`pv.mppt.voltage[${i}]`, { label: m.rd_voltage(), unit: "V", digits: 0 }),
        read.num(`pv.mppt.current[${i}]`, { label: m.rd_current(), unit: "A", digits: 1 }),
      ]),
    },
    {
      title: m.rd_siblings(),
      rows: kept(
        on.flatMap((s) =>
          s.id === id
            ? []
            : [
                read.num(`pv.string.power[${s.id}]`, {
                  label: s.name,
                  ...POWER,
                  to: formatFigure({ kind: "string", id: s.id }),
                }),
              ],
        ),
      ),
    },
  ];
}

const STATUS = new Map([
  [0, m.rd_status_standby],
  [1, m.rd_status_normal],
  [2, m.rd_status_fault],
]);

/** DC in, and the inverter's efficiency and own use while power goes through it. */
function conversion(read: Reader): Group {
  // The profile's ratio reads 0 while nothing goes in.
  const through = (read.raw("inverter.efficiency") ?? 0) > 0;

  return {
    title: m.rd_now(),
    rows: kept([
      read.num("pv.power", { label: m.rd_dc_in(), ...POWER }),
      through
        ? read.num("inverter.efficiency", { label: m.rd_efficiency(), unit: "%", digits: 1 })
        : null,
      through ? read.num("inverter.loss.power", { label: m.rd_own_use(), ...POWER }) : null,
    ]),
  };
}

export function inverter(read: Reader): Group[] {
  return [
    conversion(read),
    inputs(read),
    {
      title: m.rd_state(),
      rows: kept([
        read.text("inverter.status", m.rd_status(), (v) => STATUS.get(v)?.() ?? String(v)),
        read.num("inverter.temperature", { label: m.rd_temperature(), unit: "°C", digits: 1 }),
      ]),
    },
    pvTotal(read),
  ];
}

export function battery(read: Reader): Group[] {
  return [
    {
      title: m.rd_now(),
      rows: kept([read.num("battery.soc", { label: m.rd_soc(), unit: "%", digits: 0 })]),
    },
    {
      title: m.rd_electrical(),
      rows: kept([
        read.num("battery.voltage", { label: m.rd_voltage(), unit: "V", digits: 1 }),
        read.num("battery.current", { label: m.rd_current(), unit: "A", digits: 1 }),
      ]),
    },
    {
      title: m.rd_state(),
      rows: kept([
        read.num("battery.temperature", { label: m.rd_temperature(), unit: "°C", digits: 1 }),
        read.num("battery.capacity", { label: m.rd_capacity(), unit: "kWh", digits: 1 }),
      ]),
    },
    {
      title: m.rd_counters(),
      rows: kept([
        read.num("battery.energy.charged.total", {
          label: m.rd_charged_total(),
          ...MWH,
          digits: 2,
        }),
        read.num("battery.energy.discharged.total", {
          label: m.rd_discharged_total(),
          ...MWH,
          digits: 2,
        }),
        read.num("battery.cycles", { label: m.rd_cycles(), unit: "", digits: 0 }),
      ]),
    },
  ];
}

export function grid(read: Reader): Group[] {
  return [
    {
      title: m.rd_now(),
      rows: kept([read.num("grid.frequency", { label: m.rd_frequency(), unit: "Hz", digits: 2 })]),
    },
    tabled(
      m.rd_phases(),
      table(read, (p) => `L${p}`, [
        { role: "grid.phase.voltage", label: m.rd_voltage(), unit: "V", digits: 0 },
        { role: "grid.phase.current", label: m.rd_current(), unit: "A", digits: 1 },
        { role: "grid.phase.power", label: m.rd_power(), ...POWER },
      ]),
    ),
    {
      title: m.rd_counters(),
      rows: kept([
        read.num("grid.energy.imported.total", { label: m.rd_imported_total(), ...MWH, digits: 2 }),
        read.num("grid.energy.exported.total", { label: m.rd_exported_total(), ...MWH, digits: 2 }),
      ]),
    },
  ];
}

export function house(read: Reader, plant: Reader, points: readonly MeasurementPoint[]): Group[] {
  return [
    consumers(plant, points),
    tabled(
      m.rd_phases(),
      table(read, (p) => `L${p}`, [{ role: "load.phase.power", label: m.rd_power(), ...POWER }]),
    ),
    {
      title: m.rd_counters(),
      rows: kept([read.num("load.energy.total", { label: m.rd_load_total(), ...MWH, digits: 1 })]),
    },
  ];
}

const MODES = new Map([
  [0, m.rd_mode_off],
  [1, m.rd_mode_now],
  [2, m.rd_mode_minpv],
  [3, m.rd_mode_pv],
]);

export function generator(read: Reader): Group[] {
  return [
    {
      title: m.rd_counters(),
      rows: kept([
        read.num("generator.energy.total", { label: m.rd_generator_total(), ...MWH, digits: 1 }),
      ]),
    },
  ];
}

export function ev(read: Reader): Group[] {
  const charging = read.raw("ev.charging") === 1;

  const plugged = (v: number) => {
    if (v !== 1) return m.rd_ev_unplugged();

    return charging ? m.rd_ev_charging() : m.rd_ev_plugged();
  };

  return [
    {
      title: m.rd_now(),
      rows: kept([
        read.text("ev.connected", m.rd_ev_state(), plugged),
        read.num("ev.vehicle.soc", { label: m.rd_ev_soc(), unit: "%", digits: 0 }),
        read.num("ev.limit.soc", { label: m.rd_ev_limit(), unit: "%", digits: 0 }),
      ]),
    },
    {
      title: m.rd_session(),
      rows: kept([
        read.num("ev.session.energy", { label: m.rd_session_energy(), unit: "kWh", digits: 1 }),
        read.text("ev.mode", m.rd_ev_mode(), (v) => MODES.get(v)?.() ?? String(v)),
        read.text("ev.battery.boost", m.rd_boost(), (v) => (v === 1 ? m.rd_on() : m.rd_off())),
      ]),
    },
  ];
}
