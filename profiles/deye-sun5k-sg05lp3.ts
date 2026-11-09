import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun5k-sg05lp3",
  name: "SUN-5K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 2,
  current: 120,
  rated: 5000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 5000,
    mppt: [
      { maxCurrent: 20, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 20, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
