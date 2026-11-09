import { sg01hp3 } from "./deye/sg01hp3.ts";

export default sg01hp3({
  id: "deye-sg01hp3-20k",
  name: "SUN-20K-SG01HP3",
  version: "1.0.0",
  inputs: 4,
  current: 50,
  rated: 20000,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 20000,
    mppt: [
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
});
