// PROTOTYPE: simulated live source. No backend; ticks every 2 s with small jitter.
import { deviceOf, type DeviceId, type Reading } from "./readings";

export const TICK_MS = 2000;
/** Simulated "now": 15:00, quarter-hour 60 of 96. */
export const NOW_INDEX = 60;

export interface StringState {
  id: string;
  name: string;
  /** The MPPT input it is wired to (ADR 17); strings sharing one are in parallel. */
  input: number;
  face: "south" | "north";
  kw: number;
  peak: number;
}

export interface DayPoint {
  time: Date;
  actual: number | null;
  forecast: number;
  house: number;
  soc: number;
}

function jitter(base: number, pct = 0.035): number {
  return base * (1 + (Math.random() * 2 - 1) * pct);
}

function bell(i: number): number {
  // Sunrise 05:30, sunset 21:00 (summer), peak around 13:30.
  const t = (i / 4 - 5.5) / (21 - 5.5);
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t) ** 1.8;
}

function buildDay(): DayPoint[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const shape = Array.from({ length: 96 }, (_, i) => bell(i));
  const after = shape.slice(NOW_INDEX).reduce((a, b) => a + b, 0) * 0.25;
  const before = shape.slice(0, NOW_INDEX).reduce((a, b) => a + b, 0) * 0.25;
  const fScale = 18.5 / after;
  // Seeded noise so the curve is stable across reloads.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = shape.map((_, i) => 1 - 0.18 * Math.max(0, Math.sin(i * 0.9) * rnd()));
  const actualRaw = shape.map((s, i) => s * noise[i]!);
  const aSum = actualRaw.slice(0, NOW_INDEX).reduce((a, b) => a + b, 0) * 0.25;
  const aScale = 31.2 / aSum;
  void before;
  let soc = 22;
  return shape.map((s, i) => {
    const time = new Date(start.getTime() + i * 15 * 60_000);
    const h = i / 4;
    const house =
      0.35 +
      0.9 * Math.exp(-((h - 7.5) ** 2) / 0.8) +
      1.6 * Math.exp(-((h - 12.5) ** 2) / 0.5) +
      1.2 * Math.exp(-((h - 19) ** 2) / 1.5) +
      0.1 * rnd();
    const pv = i < NOW_INDEX ? actualRaw[i]! * aScale : s * fScale;
    soc = Math.min(100, Math.max(12, soc + (pv - house) * 0.9 * (soc > 90 ? 0.3 : 1)));
    return {
      time,
      actual: i <= NOW_INDEX ? +(actualRaw[i]! * aScale).toFixed(2) : null,
      forecast: +(s * fScale).toFixed(2),
      house: +house.toFixed(2),
      soc: Math.round(soc),
    };
  });
}

/** One sample of a live series. */
export interface LivePoint {
  t: number;
  v: number;
}
export type LiveKey = "pv" | "house" | "battery" | "grid" | "ev" | "inverter" | "s1" | "s2" | "s3" | "s4" | "s5" | "s6";
export type StreamStatus = "loading" | "live" | "stalled" | "error";

/** What the plant has: a node, card or chip shows only when its role exists (ADR 21). */
export interface Has {
  battery: boolean;
  ev: boolean;
  scene: boolean;
}

export interface SimOptions {
  /** Night: no PV, the battery discharges and the grid imports. */
  night?: boolean;
  status?: StreamStatus;
  has?: Partial<Has>;
  /** PV string count, 1..6; the 3D scene only models the first three. */
  strings?: number;
  /** Long device and plant names, to test overflow. */
  long?: boolean;
  /** Roles the profile does not map (`pv.mppt.voltage`, or one index: `pv.mppt.voltage[1]`). */
  missing?: string[];
  /** Roles whose readings stopped four minutes ago. */
  stale?: string[];
  /** Devices that stopped answering twelve minutes ago. */
  offline?: DeviceId[];
}

/** The live graph's window (ADR 21) plus the off-screen buffer it scrolls in from. */
const BUFFER_MS = 2 * 60_000 + 8 * TICK_MS;

const STRING_BASE = [3.1, 1.2, 3.5, 2.2, 1.6, 2.9];
const STRING_NAMES = ["MPPT1 Süd", "MPPT1 Nord", "MPPT2 Süd", "MPPT2 West", "MPPT3 Ost", "MPPT3 Carport"];
const STRING_NAMES_LONG = [
  "Süddach Hauptgebäude, obere Reihe (16 Module)",
  "Norddach Hauptgebäude, obere Reihe (16 Module)",
  "Süddach Hauptgebäude, untere Reihe (14 Module)",
  "Westgaube und Anbau Hauswirtschaftsraum",
  "Ostdach Garage mit Abstellraum",
  "Carport an der Grundstücksgrenze",
];
/** Strings in order, two per MPPT input; a plant with three has one input shared and one alone. */
const STRING_INPUT = [1, 1, 2, 2, 3, 3];
/** Each input's voltage at its maximum power point, from its string length. */
const INPUT_VOLTS = [536, 469, 402];
const PHASE_SHARE = [0.36, 0.31, 0.33];
const PHASE_VOLTS = [231.2, 229.4, 232.1];
const SERIES_DEVICE: Record<string, DeviceId> = { battery: "battery", grid: "meter", ev: "ev", house: "plant" };

export class LiveSim {
  /** Night: no PV, the battery discharges and the grid imports. */
  night = $state(false);
  readonly long: boolean;
  readonly has: Has;
  status = $state<StreamStatus>("live");
  /** Seconds since the last sample; counts up while the stream stalls. */
  age = $state(1);

  pv = $state(7.8);
  strings = $state<StringState[]>([]);
  house = $state(1.4);
  /** Positive = charging. */
  battery = $state(2.1);
  soc = $state(64);
  /** Negative = export. */
  grid = $state(-4.3);
  price = $state(12.4);
  ev = $state(7.4);
  evSoc = $state(52);
  inverter = $state(7.6);
  today = $state({
    production: 31.2,
    consumption: 14.8,
    feedIn: 16.9,
    purchase: 0.6,
    // ADR 12: (consumption − purchase) · 32 ct + feed-in · 8.2 ct, so History and the dashboard agree.
    saved: 5.93,
    autarky: 96,
    selfUse: 46,
  });
  weather = { temp: 21, label: "Sonnig", wind: 9, cloud: 8 };
  remaining = $state(18.5);
  tick = $state(0);
  readonly day: DayPoint[] = buildDay();
  readonly plantName: string;
  readonly evName: string;
  /** Each device's name, as its sheet shows it. */
  readonly devices: Record<DeviceId, string>;
  readonly offline: DeviceId[];

  /** Every mapped role's latest reading (ADR 4), replaced on each sample. */
  readings = $state.raw<Record<string, Reading>>({});
  /** Wall clock, ticking each second, so a stale reading's age counts up. */
  now = $state(Date.now());
  #missing: string[];
  #stale: string[];
  #counters = { pv: 48_312, load: 39_870, imported: 6_204, exported: 21_873, charged: 4_812, discharged: 4_377, session: 11.3 };

  /** Rolling two-minute series per figure, replaced (never mutated) on each sample. */
  series = $state.raw<Partial<Record<LiveKey, LivePoint[]>>>({});

  #timer: ReturnType<typeof setInterval> | undefined;
  #base: number[];

  constructor(opts: SimOptions = {}) {
    this.night = opts.night ?? false;
    this.long = opts.long ?? false;
    this.has = { battery: true, ev: true, scene: true, ...opts.has };
    this.status = opts.status ?? "live";
    this.plantName = this.long ? "Einfamilienhaus Musterstraße 4 a, Hinterhaus" : "Musterstraße 4";
    this.evName = this.long ? "Volkswagen ID.4 Pro Performance" : "ID.4";
    this.devices = {
      inverter: this.long ? "Deye SUN-12K-SG04LP3-EU Hybridwechselrichter, Hauswirtschaftsraum links" : "Deye SUN-12K-SG04LP3",
      battery: this.long ? "Pylontech Force H2 Hochvoltspeicher, vier Module im Keller" : "Pylontech Force H2",
      meter: this.long ? "Eastron SDM630 Modbus am Netzanschlusspunkt im Zählerschrank" : "Eastron SDM630",
      ev: this.long ? "EVCC-Ladepunkt Carport links, Volkswagen ID.4 Pro Performance" : "EVCC · Carport",
      plant: this.plantName,
    };
    this.#missing = opts.missing ?? [];
    this.#stale = opts.stale ?? [];
    this.offline = opts.offline ?? [];
    const n = Math.min(6, Math.max(1, opts.strings ?? 3));
    this.#base = STRING_BASE.slice(0, n);
    this.strings = this.#base.map((kw, i) => ({
      id: `s${i + 1}`,
      name: (this.long ? STRING_NAMES_LONG : STRING_NAMES)[i]!,
      input: STRING_INPUT[i]!,
      face: i % 2 === 1 ? "north" : "south",
      kw,
      peak: STRING_BASE[i]! * 1.15,
    }));
    if (!this.has.ev) this.ev = 0;
    if (!this.has.battery) this.battery = 0;
    // Back-fill the window so a detail sheet opens on a full graph.
    const now = Date.now();
    for (let t = now - BUFFER_MS; t < now; t += TICK_MS) this.sample(t);
    this.sample(now);
  }

  start(): () => void {
    if (this.status === "loading") return () => {};
    if (this.status === "live") this.#timer = setInterval(() => this.step(), TICK_MS);
    // A stalled or dropped stream keeps its last sample and only ages.
    else this.age = 14;
    const ager = setInterval(() => {
      if (this.status !== "live") this.age++;
      this.now = Date.now();
    }, 1000);
    return () => {
      clearInterval(this.#timer);
      clearInterval(ager);
    };
  }

  /** Reconnect after a stall or an error. */
  resume(): void {
    if (this.status === "live") return;
    this.status = "live";
    this.age = 1;
    this.step();
    this.#timer = setInterval(() => this.step(), TICK_MS);
  }

  /** Draw one sample of every live figure. */
  private sample(t: number): void {
    const n = this.night;
    this.strings = this.strings.map((s, i) => ({ ...s, kw: n ? 0 : +jitter(this.#base[i]!, 0.05).toFixed(2) }));
    this.pv = +this.strings.reduce((a, s) => a + s.kw, 0).toFixed(2);
    this.inverter = +(n ? 1.25 : this.pv * 0.975).toFixed(2);
    this.house = +jitter(n ? 1.3 : 1.4, 0.08).toFixed(2);
    this.ev = this.has.ev ? +jitter(n ? 0 : 7.4, 0.01).toFixed(2) : 0;
    // The battery takes what PV leaves at noon and carries the house at night.
    this.battery = this.has.battery ? +jitter(n ? -0.9 : 2.1, 0.04).toFixed(2) : 0;
    this.grid = n ? +(this.house - (this.has.battery ? 0.9 : 0) + (Math.random() - 0.5) * 0.5).toFixed(2) : -+jitter(4.3, 0.04).toFixed(2);
    this.price = +jitter(n ? 27.9 : 12.4, 0.01).toFixed(1);
    const next: Partial<Record<LiveKey, LivePoint[]>> = {};
    const cut = t - BUFFER_MS;
    const put = (k: LiveKey, v: number) => {
      const kept = (this.series[k] ?? []).filter((p) => p.t >= cut);
      // An offline device adds nothing: its graph ends where it fell silent.
      next[k] = this.offline.includes(SERIES_DEVICE[k] ?? "inverter") ? kept : [...kept, { t, v: v * 1000 }];
    };
    put("pv", this.pv);
    put("house", this.house);
    put("battery", this.battery);
    put("grid", this.grid);
    put("ev", this.ev);
    put("inverter", this.inverter);
    for (const s of this.strings) put(s.id as LiveKey, s.kw);
    this.series = next;
    this.read(t);
  }

  /** Every role this plant maps, as one reading each (ADR 4's table, units and signs). */
  private read(t: number): void {
    const was = this.readings;
    const r: Record<string, Reading> = {};
    const listed = (list: string[], key: string) => list.includes(key) || list.includes(key.replace(/\[.*\]$/, ""));
    const set = (key: string, v: number | string, est = false) => {
      if (listed(this.#missing, key)) return;
      const silent = this.offline.includes(deviceOf(key)) ? 12 * 60_000 : listed(this.#stale, key) ? 4 * 60_000 : 0;
      // A silent role keeps the reading it had when it fell silent.
      r[key] = silent ? (was[key] ?? { v, at: Date.now() - silent, ...(est && { est }) }) : { v, at: t, ...(est && { est }) };
    };
    const w = (kw: number) => Math.round(kw * 1000);
    const c = this.#counters;

    set("pv.power", w(this.pv));
    set("pv.energy.total", c.pv);
    set("inverter.power", w(this.inverter));
    const inputs = [...new Set(this.strings.map((s) => s.input))];
    for (const i of inputs) {
      const on = this.strings.filter((s) => s.input === i);
      const kw = on.reduce((a, s) => a + s.kw, 0);
      const volts = kw > 0 ? jitter(INPUT_VOLTS[i - 1]!, 0.004) : 0;
      set(`pv.mppt.power[${i}]`, w(kw));
      set(`pv.mppt.voltage[${i}]`, +volts.toFixed(1));
      set(`pv.mppt.current[${i}]`, volts > 0 ? +((kw * 1000) / volts).toFixed(1) : 0);
      // A string alone on its input is measured; parallel strings are estimates (ADR 17).
      for (const s of on) set(`pv.string.power[${s.id}]`, w(s.kw), on.length > 1);
    }

    if (this.has.battery) {
      const volts = jitter(this.battery >= 0 ? 53.1 : 51.4, 0.002);
      set("battery.power", w(this.battery));
      set("battery.soc", Math.round(this.soc));
      set("battery.capacity", 15.4);
      set("battery.voltage", +volts.toFixed(1));
      set("battery.current", +((this.battery * 1000) / volts).toFixed(1));
      set("battery.temperature", +jitter(this.battery >= 0 ? 26.5 : 24, 0.01).toFixed(1));
      set("battery.mode", Math.abs(this.battery) < 0.05 ? "idle" : this.battery > 0 ? "charging" : "discharging");
      set("battery.energy.charged.total", c.charged);
      set("battery.energy.discharged.total", c.discharged);
    }

    set("grid.power", w(this.grid));
    set("grid.frequency", +(50 + (Math.random() - 0.5) * 0.06).toFixed(2));
    PHASE_SHARE.forEach((share, i) => {
      const volts = jitter(PHASE_VOLTS[i]!, 0.002);
      const watts = w(this.grid * share);
      set(`grid.phase.voltage[${i + 1}]`, +volts.toFixed(1));
      set(`grid.phase.current[${i + 1}]`, +(watts / volts).toFixed(1));
      set(`grid.phase.power[${i + 1}]`, watts);
    });
    set("grid.energy.imported.total", c.imported);
    set("grid.energy.exported.total", c.exported);

    set("load.power", w(this.house + this.ev));
    set("load.energy.total", c.load);
    // Each measured point's own consumption (ADR 14); the root keeps what no child explains.
    if (this.has.ev) set("point.power[wallbox]", w(this.ev));
    set("point.power[root]", w(this.house));

    if (this.has.ev) {
      set("ev.charge.power", w(this.ev));
      set("ev.vehicle.soc", Math.round(this.evSoc));
      set("ev.limit.soc", 80);
      set("ev.session.energy", +c.session.toFixed(1));
      set("ev.connected", "yes");
      set("ev.charging", this.ev > 0.05 ? "yes" : "no");
      set("ev.mode", "pv");
      set("ev.battery.boost", "off");
    }
    this.readings = r;
  }

  step(): void {
    this.sample(Date.now());
    const h = TICK_MS / 3_600_000;
    this.today.production += this.pv * h;
    this.today.consumption += this.house * h;
    this.today.feedIn += Math.max(0, -this.grid) * h;
    this.today.purchase += Math.max(0, this.grid) * h;
    this.today.saved += (this.house - Math.max(0, this.grid)) * h * 0.32 + Math.max(0, -this.grid) * h * 0.082;
    this.remaining = this.night ? 0 : Math.max(0, this.remaining - this.pv * h);
    this.soc = Math.min(100, Math.max(0, this.soc + this.battery * h * 10));
    this.evSoc = Math.min(100, this.evSoc + this.ev * h * 1.4);
    const c = this.#counters;
    c.pv += this.pv * h;
    c.load += (this.house + this.ev) * h;
    c.imported += Math.max(0, this.grid) * h;
    c.exported += Math.max(0, -this.grid) * h;
    c.charged += Math.max(0, this.battery) * h;
    c.discharged += Math.max(0, -this.battery) * h;
    c.session += this.ev * h;
    this.age = 1;
    this.tick++;
  }
}

/** Day-ahead spot prices, ct/kWh per hour: cheap at midday, peaks morning and evening. */
export const SPOT: number[] = Array.from({ length: 24 }, (_, h) =>
  +(
    22 +
    6 * Math.exp(-((h - 8) ** 2) / 3) +
    11 * Math.exp(-((h - 19.5) ** 2) / 4) -
    16 * Math.exp(-((h - 13.5) ** 2) / 6)
  ).toFixed(1),
);
