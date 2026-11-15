import { defineFamily } from "../packages/sdk/src/index.ts";
import { type Inputs, sg01hp3 } from "./deye/sg01hp3.ts";
import { type Datasheet, type Model, kilowatts, modelOf } from "./deye/shared.ts";

const MPPT_20A_150V = { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 };
const MPPT_26A_150V = { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 };

/** Volts: the maximum DC input voltage of every model. */
const MAX_INPUT_VOLTAGE = 1000;

// The base serves a model whose rated power matches no variant: each limit is the range's widest,
// so a forecast never caps below the model behind it (ADR 5).
const FAMILY: Model<Inputs> = {
  id: "deye-sg01hp3",
  name: "SG01HP3",
  version: "1.0.0",
  inputs: 4,
  current: 50,
  inverter: {
    maxInputVoltage: MAX_INPUT_VOLTAGE,
    acRating: 25000,
    mppt: [MPPT_26A_150V, MPPT_26A_150V],
  },
};

/** The models, each a variant identified by its rated power and named by it in kilowatts. */
const MODELS: readonly Datasheet<Inputs>[] = [
  { name: "SUN-5K-SG01HP3", inputs: 2, current: 30, rated: 5000, mppt: MPPT_20A_150V },
  { name: "SUN-6K-SG01HP3", inputs: 2, current: 30, rated: 6000, mppt: MPPT_20A_150V },
  { name: "SUN-8K-SG01HP3", inputs: 2, current: 37, rated: 8000, mppt: MPPT_20A_150V },
  { name: "SUN-10K-SG01HP3", inputs: 2, current: 37, rated: 10000, mppt: MPPT_20A_150V },
  {
    name: "SUN-12K-SG01HP3",
    inputs: 3,
    current: 37,
    rated: 12000,
    mppt: [MPPT_26A_150V, MPPT_20A_150V],
  },
  {
    name: "SUN-15K-SG01HP3",
    inputs: 3,
    current: 37,
    rated: 15000,
    mppt: [MPPT_26A_150V, MPPT_20A_150V],
  },
  { name: "SUN-20K-SG01HP3", inputs: 4, current: 50, rated: 20000, mppt: MPPT_26A_150V },
  { name: "SUN-25K-SG01HP3", inputs: 4, current: 50, rated: 25000, mppt: MPPT_26A_150V },
];

export default defineFamily(
  sg01hp3(FAMILY),
  MODELS.map((sheet) => {
    const id = kilowatts(sheet.rated);

    return {
      id,
      profile: sg01hp3({
        ...modelOf(sheet, MAX_INPUT_VOLTAGE),
        id: FAMILY.id,
        version: FAMILY.version,
      }),
      // The per-model profile each variant was before the family was one file.
      replaces: [`deye-sg01hp3-${id}`],
    };
  }),
);
