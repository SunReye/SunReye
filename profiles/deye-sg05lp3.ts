import { defineFamily } from "../packages/sdk/src/index.ts";
import { type Inputs, sg05lp3 } from "./deye/sg05lp3.ts";
import { type Datasheet, type Model, kilowatts, modelOf } from "./deye/shared.ts";

const MPPT_20A_200V = { maxCurrent: 20, minVoltage: 200, maxVoltage: 650, startVoltage: 160 };
const MPPT_26A_200V = { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 };
const MPPT_36A_160V = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };

/** Volts: the maximum DC input voltage of every model. */
const MAX_INPUT_VOLTAGE = 800;

// The base serves a model whose rated power matches no variant: each limit is the range's widest,
// so a forecast never caps below the model behind it (ADR 5).
const FAMILY: Model<Inputs> = {
  id: "deye-sg05lp3",
  name: "SG05LP3",
  version: "2.2.0",
  inputs: 4,
  current: 350,
  inverter: {
    maxInputVoltage: MAX_INPUT_VOLTAGE,
    acRating: 20000,
    mppt: [MPPT_36A_160V, MPPT_36A_160V],
  },
};

/** The models, each a variant identified by its rated power and named by it in kilowatts. */
const MODELS: readonly Datasheet<Inputs>[] = [
  { name: "SUN-5K-SG05LP3-EU-SM2", inputs: 2, current: 120, rated: 5000, mppt: MPPT_20A_200V },
  { name: "SUN-6K-SG05LP3-EU-SM2", inputs: 2, current: 135, rated: 6000, mppt: MPPT_20A_200V },
  { name: "SUN-8K-SG05LP3-EU-SM2", inputs: 2, current: 190, rated: 8000, mppt: MPPT_26A_200V },
  { name: "SUN-10K-SG05LP3-EU-SM2", inputs: 2, current: 210, rated: 10000, mppt: MPPT_26A_200V },
  { name: "SUN-12K-SG05LP3-EU-SM2", inputs: 2, current: 240, rated: 12000, mppt: MPPT_26A_200V },
  { name: "SUN-14K-SG05LP3-EU-SM2", inputs: 4, current: 260, rated: 14000, mppt: MPPT_36A_160V },
  { name: "SUN-15K-SG05LP3-EU-SM2", inputs: 4, current: 280, rated: 15000, mppt: MPPT_36A_160V },
  { name: "SUN-16K-SG05LP3-EU-SM2", inputs: 4, current: 300, rated: 16000, mppt: MPPT_36A_160V },
  { name: "SUN-18K-SG05LP3-EU-SM2", inputs: 4, current: 330, rated: 18000, mppt: MPPT_36A_160V },
  { name: "SUN-20K-SG05LP3-EU-SM2", inputs: 4, current: 350, rated: 20000, mppt: MPPT_36A_160V },
];

export default defineFamily(
  sg05lp3(FAMILY),
  MODELS.map((sheet) => {
    const id = kilowatts(sheet.rated);

    return {
      id,
      profile: sg05lp3({
        ...modelOf(sheet, MAX_INPUT_VOLTAGE),
        id: FAMILY.id,
        version: FAMILY.version,
      }),
      // The per-model profile each variant was before the family was one file.
      replaces: [`deye-sun${id}-sg05lp3`],
    };
  }),
);
