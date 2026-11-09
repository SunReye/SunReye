import { sg05lp3 } from "./deye/sg05lp3.ts";

// The whole range, identified by its device type alone: each limit is the range's widest, so a
// forecast never caps below the model behind it (ADR 5).
export default sg05lp3({
  id: "deye-sg05lp3",
  name: "SG05LP3",
  version: "2.2.0",
  inputs: 4,
  current: 350,
  inverter: {
    maxInputVoltage: 800,
    acRating: 20000,
    mppt: [
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
