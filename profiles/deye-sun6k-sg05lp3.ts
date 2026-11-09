import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun6k-sg05lp3",
  name: "SUN-6K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 2,
  current: 135,
  rated: 6000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 6000,
    mppt: [
      { maxCurrent: 20, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 20, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
