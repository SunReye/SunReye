import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun8k-sg05lp3",
  name: "SUN-8K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 2,
  current: 190,
  rated: 8000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 8000,
    mppt: [
      { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
