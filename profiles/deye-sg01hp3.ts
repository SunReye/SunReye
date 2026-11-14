import { defineFamily } from "../packages/sdk/src/index.ts";
import { type Model, sg01hp3 } from "./deye/sg01hp3.ts";

// The base serves a model whose rated power matches no variant: each limit is the range's widest,
// so a forecast never caps below the model behind it (ADR 5).
const FAMILY: Model = {
  id: "deye-sg01hp3",
  name: "SG01HP3",
  version: "1.0.0",
  inputs: 4,
  current: 50,
  inverter: {
    maxInputVoltage: 1000,
    acRating: 25000,
    mppt: [
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
    ],
  },
};

/** The models, each a variant identified by its rated power and named by it in kilowatts. */
const MODELS: readonly Omit<Model, "id" | "version">[] = [
  {
    name: "SUN-5K-SG01HP3",
    inputs: 2,
    current: 30,
    rated: 5000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 5000,
      mppt: [
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-6K-SG01HP3",
    inputs: 2,
    current: 30,
    rated: 6000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 6000,
      mppt: [
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-8K-SG01HP3",
    inputs: 2,
    current: 37,
    rated: 8000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 8000,
      mppt: [
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-10K-SG01HP3",
    inputs: 2,
    current: 37,
    rated: 10000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 10000,
      mppt: [
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-12K-SG01HP3",
    inputs: 3,
    current: 37,
    rated: 12000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 12000,
      mppt: [
        { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-15K-SG01HP3",
    inputs: 3,
    current: 37,
    rated: 15000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 15000,
      mppt: [
        { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 20, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
  {
    name: "SUN-20K-SG01HP3",
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
  },
  {
    name: "SUN-25K-SG01HP3",
    inputs: 4,
    current: 50,
    rated: 25000,
    inverter: {
      maxInputVoltage: 1000,
      acRating: 25000,
      mppt: [
        { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
        { maxCurrent: 26, minVoltage: 150, maxVoltage: 850, startVoltage: 180 },
      ],
    },
  },
];

export default defineFamily(
  sg01hp3(FAMILY),
  MODELS.map((model) => ({
    id: `${(model.rated ?? 0) / 1000}k`,
    profile: sg01hp3({ ...model, id: FAMILY.id, version: FAMILY.version }),
  })),
);
