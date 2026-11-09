import { sg01hp3 } from "./deye/sg01hp3.ts";

// The whole range, identified by its device type alone: each limit is the range's widest, so a
// forecast never caps below the model behind it (ADR 5).
export default sg01hp3({
  id: "deye-sg01hp3",
  name: "SG01HP3",
  version: "1.0.0",
  inputs: 4,
  current: 50,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 25000,
    mppt: [
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
});
