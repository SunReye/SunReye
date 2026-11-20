// Fixed answers of the detail sheet tests' fake core (ADR 21).
export const INVERTER = "1";

export const PLANT = "4294967294";

/** Input 1 runs 15 % under its model lately. */
export const CORRECTIONS = {
  inputs: [
    {
      device: 1,
      input: 1,
      factors: [{ month: 11, hour: 10, factor: 0.85 }],
      recent: { measured: 85, modelled: 100 },
    },
  ],
};

/** Both strings share input 1, so both are estimated. */
const CAPABILITIES = {
  capabilities: [],
  schema: {},
  transports: [],
  version: "5",
  devices: {
    [INVERTER]: {
      series: [],
      settings: [],
      writes: false,
      estimated: ["pv.string.power[1]", "pv.string.power[2]"],
    },
  },
};

/** The grid connection and a heat pump below it, which a viewer reads too (ADR 9). */
export const TOPOLOGY = {
  appliesFrom: "2026-11-01T00:00:00Z",
  points: [
    { id: 1, name: "Netz", parent: null, contested: false, claims: [] },
    { id: 2, name: "Wärmepumpe", parent: 1, contested: false, claims: [] },
  ],
};

/** The capabilities, the inverter's profile publishing `series`. */
export function capabilities(series: readonly string[]) {
  const inverter = { ...CAPABILITIES.devices[INVERTER], series };

  return { ...CAPABILITIES, devices: { [INVERTER]: inverter } };
}

/** A forecast for `hour`:`minute` today, issued yesterday. */
const slot = (hour: number, value: number, minute = 0) => ({
  issued: "2026-11-11T13:00:00Z",
  target: `2026-11-12T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  value,
});

/** Today's spot prices, one of them below zero. */
export const SPOT_PRICES = {
  points: [slot(0, 0.12), slot(12, 0.125), slot(12, 0.0625, 30), slot(13, -0.01)],
};

/** The inverter expects 2 kW from 10:00 to 14:00: 8 kWh, half of it still to come. */
export const INVERTER_PLAN = { points: [10, 11, 12, 13].map((h) => slot(h, 2000)) };

export const NO_COSTS = { days: [], total: { paid: 0.32, earned: 0.33, saved: 2.1, standing: 0 } };

/** One hourly rollup of `watts` from `at`, in ms since the epoch. */
export function rollup(at: number, watts: number) {
  const [start, end] = [new Date(at).toISOString(), new Date(at + 3_600_000).toISOString()];

  return { date: start.slice(0, 10), start, end, mean: watts, integral: watts, hours: 1 };
}

/** The plant's battery discharged 2 kWh at 08:00 and charged 3 kWh at 10:00. */
function battery(from: string): Response {
  const at = (h: number) => Date.parse(from) + h * 3_600_000;

  return Response.json({ points: [rollup(at(8), -2000), rollup(at(10), 3000)], period: "hour" });
}

/** String 1 made 12 kWh in the range, string 2 3 kWh: one rollup each. */
export function statistics(device: string, series: string | null, from: string): Response {
  if (device === PLANT && series === "battery.power") return battery(from);

  const watts = { "pv.string.power[1]": 12_000, "pv.string.power[2]": 3000 }[series ?? ""];
  const at = Date.parse(from) + 10 * 3_600_000;

  if (device !== INVERTER || watts === undefined)
    return Response.json({ points: [], period: "hour" });

  return Response.json({ points: [rollup(at, watts)], period: "hour" });
}
