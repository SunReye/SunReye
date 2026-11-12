// PROTOTYPE: what a node's detail sheet reads, beyond its figure and graph. v3's node dialogs
// (dev 780b4e2, lib/inverter/node-details.ts) resolved per node; the same here, on v5's roles
// (ADR 4). Pure: the sheet renders, this decides. A role the profile does not map gives no row,
// and a group without rows is dropped.
//
// v3 reading -> v5 role
//   pv.total.power                      pv.power
//   pv.string.power                     pv.string.power, an estimate unless alone on its input (ADR 17)
//   pv.string.voltage / .current        pv.mppt.voltage / .current, by MPPT input: v5 measures the input
//   production.total                    pv.energy.total
//   inverter.power                      inverter.power
//   inverter.efficiency                 no role: derived here, inverter.power over pv.power (ADR 21's hub)
//   battery.soc/.power/.voltage/.current/.temperature/.mode, .energy.*.total   same names
//   grid.power, grid.phase.*, grid.energy.*.total                              same names; grid.frequency is v5's
//   load.power, load.energy.total       same names; point.power (ADR 14) adds each measured point
//   EVCC loadpoint fields               ev.charge.power, ev.vehicle.soc, ev.limit.soc, ev.session.energy,
//                                       ev.connected, ev.charging, ev.mode, ev.battery.boost
// No v5 role, so not shown: inverter.status, inverter.relay_status, inverter.temperature.dc/.ac,
// load.phase.*, generator.phase.*, and every "*.today" counter (ADR 4: days come from rollups).

/** One role's latest reading (ADR 4), keyed `role` or `role[index]`. */
export interface Reading {
  /** In the role's unit; a status role carries its enum value. */
  v: number | string;
  /** When it was read, ms. */
  at: number;
  /** An estimate, not a measurement (ADR 17): shown with "≈". */
  est?: boolean;
}

export type DeviceId = "inverter" | "battery" | "meter" | "ev" | "plant";

/** The device a role's reading comes from, in this fake plant. */
export function deviceOf(key: string): DeviceId {
  if (key.startsWith("battery.")) return "battery";
  if (key.startsWith("grid.")) return "meter";
  if (key.startsWith("ev.")) return "ev";
  if (key.startsWith("pv.") || key.startsWith("inverter.")) return "inverter";
  return "plant";
}

/** A silence longer than this is a gap (ADR 3): the reading is stale and shows its age. */
export const STALE_MS = 15_000;

/** What the readings are resolved from: the live source's shape, so this stays testable. */
export interface Source {
  strings: { id: string; name: string; input: number }[];
  readings: Record<string, Reading>;
  /** The clock a stale reading's age is counted against, ms. */
  now: number;
  offline: DeviceId[];
  status: string;
  devices: Record<DeviceId, string>;
}

export interface Row {
  key: string;
  label: string;
  /** In the unit shown; absent for a status row, which carries `text`. */
  value?: number;
  text?: string;
  unit: string;
  digits: number;
  /** An estimate (ADR 17): written with "≈". */
  est?: boolean;
  /** Seconds since it was read, set only once it is stale. */
  age?: number;
  /** The detail this row opens. */
  to?: string;
}

/** Indexed readings side by side: one line per MPPT input or phase, one column per role. */
export interface Table {
  cols: { label: string; unit: string }[];
  rows: { key: string; label: string; cells: (Row | null)[] }[];
}

export interface Group {
  title: string;
  /** One quiet sentence under the title, where a figure needs its reason. */
  note?: string;
  rows: Row[];
  table?: Table;
}

export interface NodeReadings {
  /** The device the readings come from, by its name. */
  device: string;
  /** Seconds the device has been silent, when it is offline. */
  silent: number | null;
  /** The sheet's own figure is an estimate. */
  leadEstimated: boolean;
  /** The sheet's own figure as last read, W: what it shows once its device has fallen silent. */
  last: number | null;
  groups: Group[];
}

const MODES: Record<string, string> = { charging: "Laden", discharging: "Entladen", idle: "Bereit", pv: "PV-Überschuss", on: "an", off: "aus" };

/** Reads rows off one sample; `at` is the clock stale ages are counted against. */
function reader(readings: Record<string, Reading>, now: number, quiet: boolean) {
  const age = (r: Reading) => (!quiet && now - r.at > STALE_MS ? { age: Math.round((now - r.at) / 1000) } : {});
  return {
    has: (key: string) => readings[key] !== undefined,
    num(key: string, label: string, unit: string, digits: number, scale = 1, to?: string): Row | null {
      const r = readings[key];
      if (!r || typeof r.v !== "number") return null;
      return { key, label, value: Math.abs(r.v) * scale, unit, digits, ...(r.est && { est: true }), ...age(r), ...(to && { to }) };
    },
    text(key: string, label: string, say: (v: string) => string = (v) => MODES[v] ?? v): Row | null {
      const r = readings[key];
      if (!r) return null;
      return { key, label, text: say(String(r.v)), unit: "", digits: 0, ...age(r) };
    },
    raw: (key: string) => readings[key],
  };
}

type Read = ReturnType<typeof reader>;
const kept = (rows: (Row | null)[]): Row[] => rows.filter((r): r is Row => r !== null);

/** One line per index; a column no line has a reading for is dropped. */
function table(read: Read, lines: { index: string | number; label: string }[], cols: { role: string; label: string; unit: string; digits: number; scale?: number }[]): Table | undefined {
  const rows = lines.map((l) => ({
    key: String(l.index),
    label: l.label,
    cells: cols.map((c) => read.num(`${c.role}[${l.index}]`, c.label, c.unit, c.digits, c.scale)),
  }));
  const used = cols.map((_, i) => rows.some((r) => r.cells[i] !== null));
  if (!used.some(Boolean)) return undefined;
  return {
    cols: cols.filter((_, i) => used[i]).map((c) => ({ label: c.label, unit: c.unit })),
    rows: rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => used[i]) })),
  };
}

const tabled = (title: string, t: Table | undefined): Group => ({ title, rows: [], ...(t && { table: t }) });

const MPPT = [
  { role: "pv.mppt.voltage", label: "Spannung", unit: "V", digits: 0 },
  { role: "pv.mppt.current", label: "Strom", unit: "A", digits: 1 },
  { role: "pv.mppt.power", label: "Leistung", unit: "kW", digits: 2, scale: 0.001 },
];

function inputs(sim: Source, read: Read): Group {
  const list = [...new Set(sim.strings.map((s) => s.input))];
  return tabled("MPPT-Eingänge", table(read, list.map((i) => ({ index: i, label: `Eingang ${i}` })), MPPT));
}

function string(sim: Source, read: Read, id: string): Group[] {
  const self = sim.strings.find((s) => s.id === id);
  if (!self) return [];
  const on = sim.strings.filter((s) => s.input === self.input);
  const i = self.input;
  const alone = on.length === 1;
  const input = read.raw(`pv.mppt.power[${i}]`);
  const own = read.raw(`pv.string.power[${id}]`);
  const share = !alone && input && own && typeof input.v === "number" && typeof own.v === "number" && input.v > 0 ? (own.v / input.v) * 100 : null;
  return [
    {
      title: "Jetzt",
      ...(!alone && { note: `Geschätzt: Eingang ${i} misst seine ${on.length} Strings gemeinsam. Die Leistung wird nach dem Modellstrom aufgeteilt.` }),
      rows: share === null ? [] : [{ key: "share", label: `Anteil an Eingang ${i}`, value: share, unit: "%", digits: 0, est: true }],
    },
    {
      title: `MPPT-Eingang ${i}`,
      // A string alone on its input is the input: its power is the sheet's figure already.
      rows: kept([
        alone ? null : read.num(`pv.mppt.power[${i}]`, "Leistung", "kW", 2, 0.001),
        read.num(`pv.mppt.voltage[${i}]`, "Spannung", "V", 0),
        read.num(`pv.mppt.current[${i}]`, "Strom", "A", 1),
      ]),
    },
    {
      title: "Weitere Strings an diesem Eingang",
      rows: kept(on.filter((s) => s.id !== id).map((s) => read.num(`pv.string.power[${s.id}]`, s.name, "kW", 2, 0.001, s.id))),
    },
  ];
}

function inverter(sim: Source, read: Read): Group[] {
  const dc = read.raw("pv.power");
  const ac = read.raw("inverter.power");
  const both = dc && ac && typeof dc.v === "number" && typeof ac.v === "number" && dc.v > 50 ? { dc: dc.v, ac: ac.v } : null;
  return [
    {
      title: "Jetzt",
      rows: kept([
        read.num("pv.power", "DC-Eingang", "kW", 2, 0.001),
        both && { key: "efficiency", label: "Wirkungsgrad", value: (both.ac / both.dc) * 100, unit: "%", digits: 1 },
        both && { key: "own", label: "Eigenbedarf", value: Math.abs(both.dc - both.ac) / 1000, unit: "kW", digits: 2 },
      ]),
    },
    inputs(sim, read),
    { title: "Zähler", rows: kept([read.num("pv.energy.total", "Ertrag gesamt", "MWh", 1, 0.001)]) },
  ];
}

function battery(read: Read): Group[] {
  return [
    { title: "Jetzt", rows: kept([read.num("battery.soc", "Ladezustand", "%", 0), read.text("battery.mode", "Betriebsart")]) },
    { title: "Elektrisch", rows: kept([read.num("battery.voltage", "Spannung", "V", 1), read.num("battery.current", "Strom", "A", 1)]) },
    { title: "Zustand", rows: kept([read.num("battery.temperature", "Temperatur", "°C", 1), read.num("battery.capacity", "Kapazität", "kWh", 1)]) },
    {
      title: "Zähler",
      rows: kept([
        read.num("battery.energy.charged.total", "Geladen gesamt", "MWh", 2, 0.001),
        read.num("battery.energy.discharged.total", "Entladen gesamt", "MWh", 2, 0.001),
      ]),
    },
  ];
}

function grid(read: Read): Group[] {
  const phases = [1, 2, 3].filter((p) => read.has(`grid.phase.power[${p}]`) || read.has(`grid.phase.voltage[${p}]`) || read.has(`grid.phase.current[${p}]`));
  return [
    { title: "Jetzt", rows: kept([read.num("grid.frequency", "Frequenz", "Hz", 2)]) },
    tabled(
      "Phasen",
      table(read, phases.map((p) => ({ index: p, label: `L${p}` })), [
        { role: "grid.phase.voltage", label: "Spannung", unit: "V", digits: 0 },
        { role: "grid.phase.current", label: "Strom", unit: "A", digits: 1 },
        { role: "grid.phase.power", label: "Leistung", unit: "kW", digits: 2, scale: 0.001 },
      ]),
    ),
    {
      title: "Zähler",
      rows: kept([
        read.num("grid.energy.imported.total", "Bezug gesamt", "MWh", 2, 0.001),
        read.num("grid.energy.exported.total", "Einspeisung gesamt", "MWh", 2, 0.001),
      ]),
    },
  ];
}

function house(read: Read): Group[] {
  return [
    {
      title: "Verbraucher",
      rows: kept([
        read.num("point.power[wallbox]", "Wallbox", "kW", 2, 0.001, "ev"),
        // ADR 14: what no measured point explains is shown, never hidden.
        read.has("point.power[wallbox]") ? read.num("point.power[root]", "Nicht einzeln gemessen", "kW", 2, 0.001) : null,
      ]),
    },
    { title: "Zähler", rows: kept([read.num("load.energy.total", "Verbrauch gesamt", "MWh", 1, 0.001)]) },
  ];
}

function ev(read: Read): Group[] {
  const charging = read.raw("ev.charging")?.v === "yes";
  const state = read.text("ev.connected", "Status", (v) => (v !== "yes" ? "Nicht verbunden" : charging ? "Lädt" : "Verbunden"));
  return [
    { title: "Jetzt", rows: kept([state, read.num("ev.vehicle.soc", "Ladezustand Fahrzeug", "%", 0), read.num("ev.limit.soc", "Ladeziel", "%", 0)]) },
    {
      title: "Ladevorgang",
      rows: kept([read.num("ev.session.energy", "Geladen", "kWh", 1), read.text("ev.mode", "Lademodus"), read.text("ev.battery.boost", "Batterie-Boost")]),
    },
  ];
}

/** The role a sheet leads with; a string's is its own index. Its device is the sheet's device. */
const LEAD_ROLE: Record<string, string> = {
  inverter: "inverter.power",
  solar: "pv.power",
  battery: "battery.power",
  grid: "grid.power",
  house: "point.power[root]",
  ev: "ev.charge.power",
};

/** A node's readings, or null when the sheet is not a node's (a day figure, the price). */
export function nodeReadings(id: string, sim: Source): NodeReadings | null {
  const isString = /^s\d+$/.test(id);
  if (!isString && !["inverter", "solar", "battery", "grid", "house", "ev"].includes(id)) return null;
  const lead = sim.readings[LEAD_ROLE[id] ?? `pv.string.power[${id}]`];
  const device: DeviceId = deviceOf(LEAD_ROLE[id] ?? "pv.string.power");
  const offline = sim.offline.includes(device);
  // One notice covers a silent device or a stalled stream; a row's own age is for the exception.
  const read = reader(sim.readings, sim.now, offline || sim.status !== "live");
  const groups: Group[] =
    id === "inverter" ? inverter(sim, read)
    : id === "solar" ? [inputs(sim, read), { title: "Zähler", rows: kept([read.num("pv.energy.total", "Ertrag gesamt", "MWh", 1, 0.001)]) }]
    : id === "battery" ? battery(read)
    : id === "grid" ? grid(read)
    : id === "house" ? house(read)
    : id === "ev" ? ev(read)
    : string(sim, read, id);
  return {
    device: sim.devices[device],
    silent: offline && lead ? Math.round((sim.now - lead.at) / 1000) : null,
    leadEstimated: lead?.est === true,
    last: typeof lead?.v === "number" ? lead.v : null,
    groups: groups.filter((g) => g.rows.length > 0 || g.table !== undefined || g.note !== undefined),
  };
}

/** "vor 42 s", "vor 4 min", "vor 3 h": how old a reading is. */
export function ago(seconds: number): string {
  if (seconds < 90) return `vor ${seconds} s`;
  if (seconds < 90 * 60) return `vor ${Math.round(seconds / 60)} min`;
  return `vor ${Math.round(seconds / 3600)} h`;
}
