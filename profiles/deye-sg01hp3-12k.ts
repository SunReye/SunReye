import { sg01hp3 } from "./deye/sg01hp3.ts";

export default sg01hp3({
  id: "deye-sg01hp3-12k",
  name: "SUN-12K-SG01HP3",
  version: "1.0.0",
  inputs: 3,
  current: 37,
  rated: 12000,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 12000,
    mppt: [
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
});
