import { defineFamily } from "../packages/sdk/src/index.ts";
import { type Model, sg05lp3 } from "./deye/sg05lp3.ts";

// The base serves a model whose rated power matches no variant: each limit is the range's widest,
// so a forecast never caps below the model behind it (ADR 5).
const FAMILY: Model = {
  id: "deye-sg05lp3",
  name: "SG05LP3",
  version: "2.2.0",
  inputs: 4,
  current: 350,
  inverter: {
    maxInputVoltage: 800,
    acRating: 20000,
    mppt: [
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
    ],
  },
};

/** The models, each a variant identified by its rated power and named by it in kilowatts. */
const MODELS: readonly Omit<Model, "id" | "version">[] = [
  {
    name: "SUN-5K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-6K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-8K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-10K-SG05LP3-EU-SM2",
    inputs: 2,
    current: 210,
    rated: 10000,
    inverter: {
      maxInputVoltage: 800,
      acRating: 10000,
      mppt: [
        { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
        { maxCurrent: 26, minVoltage: 200, maxVoltage: 650, startVoltage: 160 },
      ],
    },
  },
  {
    name: "SUN-12K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-14K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-15K-SG05LP3-EU-SM2",
    inputs: 4,
    current: 280,
    rated: 15000,
    inverter: {
      maxInputVoltage: 800,
      acRating: 15000,
      mppt: [
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      ],
    },
  },
  {
    name: "SUN-16K-SG05LP3-EU-SM2",
    inputs: 4,
    current: 300,
    rated: 16000,
    inverter: {
      maxInputVoltage: 800,
      acRating: 16000,
      mppt: [
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      ],
    },
  },
  {
    name: "SUN-18K-SG05LP3-EU-SM2",
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
  },
  {
    name: "SUN-20K-SG05LP3-EU-SM2",
    inputs: 4,
    current: 350,
    rated: 20000,
    inverter: {
      maxInputVoltage: 800,
      acRating: 20000,
      mppt: [
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
        { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 },
      ],
    },
  },
];

export default defineFamily(
  sg05lp3(FAMILY),
  MODELS.map((model) => ({
    id: `${(model.rated ?? 0) / 1000}k`,
    profile: sg05lp3({ ...model, id: FAMILY.id, version: FAMILY.version }),
  })),
);
