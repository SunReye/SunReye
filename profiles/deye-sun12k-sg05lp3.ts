import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun12k-sg05lp3",
  name: "SUN-12K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 2,
  current: 240,
  rated: 12000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 12000,
    mppt: [
      { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
