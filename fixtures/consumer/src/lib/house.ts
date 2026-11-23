// A detached house with a gable roof facing south, and a module type the frame lays.
import type { ModuleType, Scene } from "@sunreye/scene";

export const scene: Scene = {
  north: 0,
  blocks: [
    {
      x: 0,
      z: 0,
      rotation: 0,
      width: 10,
      depth: 8,
      eave: 3,
      roof: { kind: "gable", pitch: 35 },
    },
  ],
  obstacles: [],
  grids: [],
};

export const MODULE: ModuleType = {
  id: 1,
  name: "Fixture 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};
