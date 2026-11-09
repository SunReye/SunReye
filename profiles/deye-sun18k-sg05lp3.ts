import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun18k-sg05lp3",
  name: "SUN-18K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 4,
  current: 330,
  rated: 18000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 18000,
    mppt: [
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
