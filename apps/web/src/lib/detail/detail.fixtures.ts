// Fixed answers of the detail sheet tests' fake core (ADR 21).
export const INVERTER = "1";

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
export const CAPABILITIES = {
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
