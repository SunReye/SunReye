import { sg01hp3 } from "./deye/sg01hp3.ts";

export default sg01hp3({
  id: "deye-sg01hp3-10k",
  name: "SUN-10K-SG01HP3",
  version: "1.0.0",
  inputs: 2,
  current: 37,
  rated: 10000,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 10000,
    mppt: [
      { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
});
