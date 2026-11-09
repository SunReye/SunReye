import { sg05lp3 } from "./deye/sg05lp3.ts";

export default sg05lp3({
  id: "deye-sun14k-sg05lp3",
  name: "SUN-14K-SG05LP3-EU-SM2",
  version: "1.0.0",
  inputs: 4,
  current: 260,
  rated: 14000,
  inverter: {
    maxInputVoltage: 800,
    acRating: 14000,
    mppt: [
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
    ],
  },
});
