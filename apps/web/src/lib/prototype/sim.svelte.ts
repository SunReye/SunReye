// PROTOTYPE: simulated live source. No backend; ticks every 2 s with small jitter.

export const TICK_MS = 2000;
/** Simulated "now": 15:00, quarter-hour 60 of 96. */
export const NOW_INDEX = 60;

export interface StringState {
  id: string;
  name: string;
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

export class LiveSim {
  pv = $state(7.8);
  strings = $state<StringState[]>([
    { id: "s1", name: "MPPT1 Süd", face: "south", kw: 3.1, peak: 3.6 },
    { id: "s2", name: "MPPT1 Nord", face: "north", kw: 1.2, peak: 2.4 },
    { id: "s3", name: "MPPT2 Süd", face: "south", kw: 3.5, peak: 3.6 },
  ]);
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
    saved: 6.4,
    autarky: 96,
    selfUse: 46,
  });
  weather = { temp: 21, label: "Sonnig", wind: 9, cloud: 8 };
  remaining = $state(18.5);
  tick = $state(0);
  readonly day: DayPoint[] = buildDay();

  #timer: ReturnType<typeof setInterval> | undefined;

  start(): () => void {
    this.#timer = setInterval(() => this.step(), TICK_MS);
    return () => clearInterval(this.#timer);
  }

  step(): void {
    const base = [3.1, 1.2, 3.5];
    this.strings = this.strings.map((s, i) => ({ ...s, kw: +jitter(base[i]!, 0.05).toFixed(2) }));
    this.pv = +this.strings.reduce((a, s) => a + s.kw, 0).toFixed(2);
    this.inverter = +(this.pv * 0.975).toFixed(2);
    this.house = +jitter(1.4, 0.08).toFixed(2);
    this.battery = +jitter(2.1, 0.04).toFixed(2);
    this.grid = -+jitter(4.3, 0.04).toFixed(2);
    this.ev = +jitter(7.4, 0.01).toFixed(2);
    this.price = +jitter(12.4, 0.01).toFixed(1);
    const h = TICK_MS / 3_600_000;
    this.today.production += this.pv * h;
    this.today.consumption += this.house * h;
    this.today.feedIn += -this.grid * h;
    this.today.saved += this.house * h * 0.32;
    this.remaining = Math.max(0, this.remaining - this.pv * h);
    this.soc = Math.min(100, this.soc + this.battery * h * 10);
    this.evSoc = Math.min(100, this.evSoc + this.ev * h * 1.4);
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
