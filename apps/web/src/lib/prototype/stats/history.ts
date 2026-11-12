// PROTOTYPE: deterministic fake history for the Statistics screen. Hourly, plant-local wall clock,
// DST ignored. Every figure derives from the same hourly flows, so energy balances and money follows
// the tariff: pv − feedIn = load − imp + charge − discharge, saved = (load − imp)·price + feedIn·feedInPrice.

/** The prototype's "now": a clear June afternoon, matching the dashboard's simulated day. */
export const SIM_NOW = new Date(2026, 5, 18, 15, 0);
/** What the dashboard's sim holds for today at load; the live sim grows from here. */
export const TODAY_BASE = { production: 31.2, consumption: 14.8, feedIn: 16.9, purchase: 0.6 };

export interface HistoryOptions {
  /** PV string count, 1..6. */
  strings?: number;
  battery?: boolean;
  ev?: boolean;
  /** Ten years of history instead of two and a half: the overflow case. */
  long?: boolean;
  /** Recording began five days ago: the first-week case. */
  fresh?: boolean;
}

export interface StringMeta {
  id: string;
  name: string;
  /** MPPT input number; strings on one input are measured together (ADR 17). */
  mppt: number;
  face: string;
  kwp: number;
}

export interface TariffVersion {
  /** Day index the version applies from. */
  from: number;
  /** ct/kWh. */
  imp: number;
  feedIn: number;
}

export interface Gap {
  /** Hour indexes, end exclusive. */
  t0: number;
  t1: number;
}

export interface CapacityPoint {
  day: number;
  kwh: number;
}

export type Fields = Record<string, Float64Array>;

export interface History {
  /** Day 0. */
  start: Date;
  /** Day index of today and the hour index of now (the running hour is live-only). */
  today: number;
  nowT: number;
  /** Days stored, including the forecast horizon after today. */
  days: number;
  hour: Fields;
  day: Fields;
  strings: StringMeta[];
  tariff: TariffVersion[];
  gaps: Gap[];
  /** Day the battery and the EV first report, or null when the plant has none. */
  batteryFrom: number | null;
  evFrom: number | null;
  nameplateKwh: number;
  /** Usable capacity inferred from SOC over each full-to-empty discharge; there is no vendor SOH register. */
  capacity: CapacityPoint[];
  investment: number;
  /** Day the weak MPPT input began to underperform. */
  weakFrom: number;
}

const DAY_MS = 86_400_000;

export function dayIndex(start: Date, d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY_MS);
}
export function dateOf(start: Date, day: number): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + day);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Face {
  /** Hours the face's peak sits after solar noon. */
  shift: number;
  /** Yield relative to a south face, in winter and in summer. */
  winter: number;
  summer: number;
}
const FACES: Record<string, Face> = {
  Süd: { shift: 0, winter: 1, summer: 1 },
  Nord: { shift: 0, winter: 0.2, summer: 0.58 },
  West: { shift: 2.3, winter: 0.7, summer: 0.86 },
  Ost: { shift: -2.3, winter: 0.7, summer: 0.86 },
  Carport: { shift: 0, winter: 0.55, summer: 0.94 },
};
const STRINGS: StringMeta[] = [
  { id: "s1", name: "MPPT1 Süd", mppt: 1, face: "Süd", kwp: 4.0 },
  { id: "s2", name: "MPPT1 Nord", mppt: 1, face: "Nord", kwp: 4.0 },
  { id: "s3", name: "MPPT2 Süd", mppt: 2, face: "Süd", kwp: 3.5 },
  { id: "s4", name: "MPPT2 West", mppt: 2, face: "West", kwp: 2.6 },
  { id: "s5", name: "MPPT3 Ost", mppt: 3, face: "Ost", kwp: 1.8 },
  { id: "s6", name: "MPPT3 Carport", mppt: 3, face: "Carport", kwp: 3.3 },
];
/** The weak input's string, and the one whose modules face further east than the layout says. */
const WEAK = 2;
const WEAK_FACTOR = 0.86;
const MISFACED = 0;
const MISFACE_SHIFT = -0.7;

const gauss = (h: number, mu: number, s: number) => Math.exp(-((h - mu) ** 2) / (2 * s * s));
const SPOT_SHAPE = Array.from({ length: 24 }, (_, h) => 22 + 6 * gauss(h, 8, 1.2) + 11 * gauss(h, 19.5, 1.4));

const cache = new Map<string, History>();

export function buildHistory(opts: HistoryOptions = {}): History {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;

  const n = Math.min(6, Math.max(1, opts.strings ?? 3));
  const strings = STRINGS.slice(0, n);
  const todayDate = new Date(SIM_NOW.getFullYear(), SIM_NOW.getMonth(), SIM_NOW.getDate());
  const start = opts.fresh ? dateOf(todayDate, -5) : opts.long ? new Date(2016, 5, 1) : new Date(2024, 0, 1);
  const di = (y: number, m: number, d: number) => dayIndex(start, new Date(y, m - 1, d));
  const today = dayIndex(start, todayDate);
  const nowHour = SIM_NOW.getHours();
  const nowT = today * 24 + nowHour;
  // Weather reaches today and two more days (ADR 17), so the forecast does too.
  const days = today + 3;
  const T = days * 24;

  const names = ["pv", "load", "feedIn", "imp", "charge", "discharge", "ev", "fc", "fcx", "saved", "cost", "revenue", "hours", "gap", "spot", "soc"];
  for (let i = 0; i < n; i++) names.push(`s${i}`, `m${i}`);
  const hour: Fields = {};
  const day: Fields = {};
  for (const f of names) {
    hour[f] = new Float64Array(T);
    day[f] = new Float64Array(days);
  }
  const H = (f: string) => hour[f]!;

  const tariff: TariffVersion[] = opts.fresh
    ? [{ from: 0, imp: 32.0, feedIn: 8.2 }]
    : [
        ...(opts.long
          ? [
              { from: 0, imp: 28.5, feedIn: 12.3 },
              { from: di(2019, 1, 1), imp: 30.2, feedIn: 12.3 },
              { from: di(2022, 4, 1), imp: 39.8, feedIn: 12.3 },
            ]
          : []),
        { from: opts.long ? di(2024, 1, 1) : 0, imp: 36.5, feedIn: opts.long ? 12.3 : 8.2 },
        { from: di(2025, 3, 1), imp: 32.0, feedIn: opts.long ? 12.3 : 8.2 },
      ];
  const gaps: Gap[] = opts.fresh
    ? []
    : [
        { t0: di(2025, 8, 17) * 24 + 2, t1: di(2025, 8, 17) * 24 + 6 },
        { t0: di(2026, 2, 3) * 24 + 10, t1: di(2026, 2, 5) * 24 + 14 },
      ];
  const hasBattery = opts.battery ?? true;
  const hasEv = opts.ev ?? true;
  const batteryFrom = !hasBattery ? null : opts.fresh ? 0 : opts.long ? di(2018, 3, 1) : di(2024, 9, 12);
  const evFrom = !hasEv ? null : opts.fresh ? 0 : di(2025, 4, 5);
  const weakFrom = opts.fresh ? Infinity : di(2026, 3, 9);
  const nameplateKwh = 10;

  const rnd = mulberry32(20261112);
  const capacity: CapacityPoint[] = [];
  let weather = 0;
  let soc = 3;
  let fullAt = -99;
  let gi = 0;

  for (let d = 0; d < days; d++) {
    const date = dateOf(start, d);
    const doy = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS);
    const season = 0.5 + 0.5 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
    const dayLen = 8 + 7.6 * season;
    const noon = 12.4 + (doy > 87 && doy < 299 ? 1 : 0);
    const peak = 0.25 + 0.47 * season;

    weather = 0.55 * weather + (rnd() + rnd() + rnd() - 1.5) * 0.9;
    let cloud = Math.min(1, Math.max(0.08, 0.66 + 0.2 * season + 0.42 * weather));
    if (d === today) cloud = 0.95;
    const mixed = cloud > 0.3 && cloud < 0.88;
    const predicted = Math.min(1, Math.max(0.08, cloud + (rnd() - 0.5) * (mixed ? 0.5 : 0.12)));
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const loadDay = (0.8 + 0.4 * rnd()) * (weekend ? 1.1 : 1) * (1.24 - 0.24 * season) * 0.78;
    let evLeft = evFrom !== null && d >= evFrom && rnd() < 0.42 ? 5 + 11 * rnd() : 0;
    const evNoon = cloud > 0.6;
    const price = tariff.findLast((v) => v.from <= d)!;
    const years = date.getFullYear() + doy / 365;
    const spotLevel = (years > 2021.6 && years < 2023.3 ? 2.1 : 1) * (0.7 + 0.6 * rnd());
    const cap = batteryFrom !== null && d >= batteryFrom ? nameplateKwh * (1 - 0.034 * ((d - batteryFrom) / 365)) : 0;
    const floor = cap * 0.1;
    if (cap > 0 && soc < floor) soc = floor;

    for (let h = 0; h < 24; h++) {
      const t = d * 24 + h;
      const hourCloud = mixed ? Math.min(1.05, Math.max(0.05, cloud * (1 + (rnd() - 0.5) * 0.7))) : cloud;
      const sun = (shift: number) => {
        const x = (h + 0.5 - noon - shift) / (dayLen / 2);
        return Math.abs(x) >= 1 ? 0 : Math.cos((Math.PI * x) / 2) ** 1.7;
      };
      let pv = 0;
      let fc = 0;
      const perString: number[] = [];
      const perModel: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = strings[i]!;
        const face = FACES[s.face]!;
        const amp = s.kwp * peak * (face.winter + (face.summer - face.winter) * season);
        const modelled = amp * sun(face.shift) * hourCloud;
        let measured = amp * sun(face.shift + (i === MISFACED ? MISFACE_SHIFT : 0)) * hourCloud * (1 + (rnd() - 0.5) * 0.05);
        if (i === WEAK && d >= weakFrom) measured *= WEAK_FACTOR;
        perString.push(measured);
        perModel.push(modelled);
        pv += measured;
        fc += amp * sun(face.shift) * predicted;
      }
      H("fc")[t] = fc;
      // Spot falls when the sun is out; it is context only and never prices the bill (ADR 12).
      H("spot")[t] = Math.max(-2, SPOT_SHAPE[h]! * spotLevel - 17 * hourCloud * season * gauss(h, 13.5, 2.4) + (rnd() - 0.5) * 3);

      if (t >= nowT) continue;
      while (gi < gaps.length && gaps[gi]!.t1 <= t) gi++;
      if (gi < gaps.length && t >= gaps[gi]!.t0) {
        H("gap")[t] = 1;
        continue;
      }

      let load = (0.28 + 0.5 * gauss(h, 7, 1) + 0.55 * gauss(h, 12.5, 1) + 0.95 * gauss(h, 19, 1.6)) * loadDay * (1 + (rnd() - 0.5) * 0.24);
      let ev = 0;
      if (evLeft > 0 && (evNoon ? h >= 11 && h < 16 : h >= 18 && h < 23)) {
        ev = Math.min(evLeft, evNoon ? 4.2 : 7.4);
        evLeft -= ev;
        load += ev;
      }
      const surplus = pv - load;
      let charge = 0;
      let discharge = 0;
      if (cap > 0) {
        if (surplus > 0) {
          charge = Math.min(surplus, 5, (cap - soc) / 0.96);
          soc += charge * 0.96;
          if (soc >= cap * 0.97) fullAt = t;
        } else {
          discharge = Math.min(-surplus, 5, (soc - floor) * 0.96);
          soc -= discharge / 0.96;
          if (soc <= floor + 0.05 && t - fullAt < 20) {
            capacity.push({ day: d, kwh: cap * (1 + (rnd() - 0.5) * 0.045) });
            fullAt = -99;
          }
        }
      }
      H("pv")[t] = pv;
      H("load")[t] = load;
      H("ev")[t] = ev;
      H("charge")[t] = charge;
      H("discharge")[t] = discharge;
      H("feedIn")[t] = Math.max(0, surplus - charge);
      H("imp")[t] = Math.max(0, -surplus - discharge);
      H("soc")[t] = cap > 0 ? soc / cap : 0;
      H("hours")[t] = 1;
      for (let i = 0; i < n; i++) {
        H(`s${i}`)[t] = perString[i]!;
        H(`m${i}`)[t] = perModel[i]!;
      }
    }

    if (d === today) {
      matchDashboard(hour, today * 24, nowHour, n, cap > 0);
      // The dashboard's forecast for today: 31.2 kWh made, 18.5 kWh still to come.
      let f = 0;
      for (let h = 0; h < 24; h++) f += H("fc")[today * 24 + h]!;
      for (let h = 0; h < 24; h++) H("fc")[today * 24 + h]! *= 49.7 / f;
    }

    for (let h = 0; h < 24; h++) {
      const t = d * 24 + h;
      if (H("hours")[t]) {
        H("fcx")[t] = H("fc")[t]!;
        H("cost")[t] = (H("imp")[t]! * price.imp) / 100;
        H("revenue")[t] = (H("feedIn")[t]! * price.feedIn) / 100;
        H("saved")[t] = ((H("load")[t]! - H("imp")[t]!) * price.imp) / 100 + H("revenue")[t]!;
      }
      for (const f of names) day[f]![d]! += hour[f]![t]!;
    }
  }

  const history: History = {
    start,
    today,
    nowT,
    days,
    hour,
    day,
    strings,
    tariff,
    gaps,
    batteryFrom,
    evFrom,
    nameplateKwh,
    capacity,
    investment: 19_800,
    weakFrom,
  };
  cache.set(key, history);
  return history;
}

/** Today's elapsed hours are rescaled to the dashboard's totals, so both screens say the same. */
function matchDashboard(hour: Fields, t0: number, hours: number, n: number, battery: boolean): void {
  const sum = (f: string) => {
    let s = 0;
    for (let h = 0; h < hours; h++) s += hour[f]![t0 + h]!;
    return s;
  };
  const kPv = TODAY_BASE.production / sum("pv");
  const kLoad = TODAY_BASE.consumption / sum("load");
  let surplus = 0;
  let night = 0;
  for (let h = 0; h < hours; h++) {
    const t = t0 + h;
    hour.pv![t]! *= kPv;
    hour.load![t]! *= kLoad;
    hour.ev![t]! *= kLoad;
    for (let i = 0; i < n; i++) {
      hour[`s${i}`]![t]! *= kPv;
      hour[`m${i}`]![t]! *= kPv;
    }
    surplus += Math.max(0, hour.pv![t]! - hour.load![t]!);
    if (hour.pv![t]! < hour.load![t]!) night += hour.load![t]! - hour.pv![t]!;
  }
  // Without a battery nothing can shift: every surplus is fed in and every deficit bought.
  const kFeed = battery ? Math.min(1, TODAY_BASE.feedIn / surplus) : 1;
  const kImp = battery ? Math.min(1, TODAY_BASE.purchase / night) : 1;
  for (let h = 0; h < hours; h++) {
    const t = t0 + h;
    const d = hour.pv![t]! - hour.load![t]!;
    hour.feedIn![t] = d > 0 ? d * kFeed : 0;
    hour.imp![t] = d < 0 ? -d * kImp : 0;
    const net = hour.pv![t]! - hour.feedIn![t]! - (hour.load![t]! - hour.imp![t]!);
    hour.charge![t] = Math.max(0, net);
    hour.discharge![t] = Math.max(0, -net);
  }
}
