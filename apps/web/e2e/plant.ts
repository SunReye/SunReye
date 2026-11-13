// The fake core's plant: smooth, deterministic power for any instant, in a zone where it is midday
// when the run starts, so every journey sees the sun, the battery and the EV at work.

export const PLANT = 4_294_967_294;
const TARIFF = 4_294_967_293;
export const SPOT = 4_294_967_292;
const WEATHER = 4_294_967_295;
export const INVERTER = 1;
export const BATTERY = 2;
export const CHARGER = 3;

const HOUR = 3_600_000;

/** A fixed-offset IANA zone and its offset from UTC in hours. */
export interface Zone {
  readonly name: string;
  readonly offset: number;
}

/** A fixed-offset zone where `now` is about half past noon; Etc/GMT signs are inverted. */
export function middayZone(now: number): Zone {
  const utc = (now % (24 * HOUR)) / HOUR;
  const offset = ((Math.round(12.5 - utc) + 36) % 24) - 12;
  const sign = offset > 0 ? "-" : "+";

  return { name: `Etc/GMT${sign}${Math.abs(offset)}`, offset };
}

const bump = (h: number, centre: number, width: number) => Math.exp(-(((h - centre) / width) ** 2));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The plant's powers in W at plant-local hour `h`. */
interface Powers {
  readonly h: number;
  readonly sun: number;
  readonly season: number;
  readonly pv: number;
  readonly charging: number;
  readonly load: number;
  readonly soc: number;
  readonly battery: number;
  readonly grid: number;
}

/** Charges from any surplus; covers the house only in the evening, so mornings and nights buy. */
function battery(h: number, surplus: number, soc: number): number {
  if (surplus > 0) return soc >= 100 ? 0 : Math.min(surplus, 3000);

  return h >= 17 ? Math.max(surplus, -1200) : 0;
}

function powers(t: number, offset: number): Powers {
  const h = (((t / HOUR + offset) % 24) + 24) % 24;
  const day = Math.floor((t + offset * HOUR) / (24 * HOUR));
  const season = 0.6 + 0.4 * Math.cos((2 * Math.PI * ((day % 365) - 172)) / 365);
  const cloud = 0.82 + 0.12 * Math.sin(t / 420_000) + 0.06 * Math.sin(t / 37_000 + day);
  const sun = Math.max(0, Math.sin((Math.PI * (h - 6.5)) / 12)) ** 1.3;
  const pv = Math.round(8200 * season * sun * cloud);
  const charging = h >= 11 && h < 14.5 ? 3700 : 0;
  const house = 380 + 700 * bump(h, 7.5, 1) + 1300 * bump(h, 19, 1.6) + 120 * Math.sin(t / 95_000);
  const load = Math.round(house) + charging;
  const soc = clamp(25 + 60 * clamp((h - 8) / 6, 0, 1) - 45 * clamp((h - 17) / 7, 0, 1), 10, 100);
  const stored = Math.round(battery(h, pv - load, soc));

  return { h, sun, season, pv, charging, load, soc, battery: stored, grid: load + stored - pv };
}

function plantDevice(p: Powers) {
  const supplied = Math.min(p.load, p.pv - Math.max(p.battery, 0)) + Math.max(-p.battery, 0);

  return {
    "pv.power": p.pv,
    "load.power": p.load,
    "grid.power": p.grid,
    "grid.import.power": Math.max(p.grid, 0),
    "grid.export.power": Math.max(-p.grid, 0),
    "battery.power": p.battery,
    "battery.soc": Math.round(p.soc),
    "ev.charge.power": p.charging,
    "self.consumption.power": p.pv - Math.max(-p.grid, 0),
    "self.supply.power": clamp(supplied, 0, p.load),
  };
}

function inverter(p: Powers) {
  return {
    "pv.power": p.pv,
    "inverter.power": Math.round(p.pv * 0.97),
    "inverter.status": 1,
    "inverter.temperature": Math.round(30 + 12 * p.sun),
    "pv.mppt.power[1]": Math.round(p.pv * 0.64),
    "pv.mppt.power[2]": Math.round(p.pv * 0.36),
    "pv.string.power[1]": Math.round(p.pv * 0.64),
    "pv.string.power[2]": Math.round(p.pv * 0.36),
  };
}

/** Every value the plant's devices publish at `t`, by device id then series. */
export function plantAt(t: number, offset: number) {
  const p = powers(t, offset);

  return {
    [PLANT]: plantDevice(p),
    [INVERTER]: inverter(p),
    [BATTERY]: {
      "battery.power": p.battery,
      "battery.soc": Math.round(p.soc),
      "battery.temperature": 21,
    },
    [CHARGER]: {
      "ev.charge.power": p.charging,
      "ev.connected": 1,
      "ev.charging": p.charging > 0 ? 1 : 0,
      "ev.vehicle.soc": Math.round(40 + 10 * clamp(p.h - 11, 0, 3.5)),
    },
    [SPOT]: {
      "price.spot": Math.round((0.09 + 0.05 * bump(p.h, 19, 2.5) - 0.07 * p.sun) * 1000) / 1000,
    },
    [TARIFF]: { "price.import": 0.32, "price.export": 0.08 },
    [WEATHER]: {
      "weather.temperature": Math.round(6 + 6 * p.sun),
      "weather.ghi": Math.round(650 * p.season * p.sun),
      "weather.dhi": Math.round(180 * p.sun),
    },
  } satisfies Record<number, Record<string, number>>;
}

/** One series' value at `t`, or undefined where the device does not publish it. */
export function valueAt(
  device: number,
  series: string,
  t: number,
  offset: number,
): number | undefined {
  const values: Readonly<Record<number, Readonly<Record<string, number>> | undefined>> = plantAt(
    t,
    offset,
  );

  return values[device]?.[series];
}
