import { sg01hp3 } from "./deye/sg01hp3.ts";

export default sg01hp3({
  id: "deye-sg01hp3-6k",
  name: "SUN-6K-SG01HP3",
  version: "1.0.0",
  inputs: 2,
  current: 30,
  rated: 6000,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 6000,
    mppt: [
      { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
});
