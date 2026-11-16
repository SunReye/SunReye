// What is laid over a finish and only drawn (ADR 20 Look): the dirt a sill sheds down its
// wall, and the light a lit opening spills on the ground at night.
import { AdditiveBlending, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { generated } from "./materials.ts";
import { seeping } from "./weather.ts";

/** Dirt run down a wall from a sill: a dark wash over the plaster under it, drawn only. */
export function soiled(): MeshStandardMaterial {
  return seeping(
    new MeshStandardMaterial({
      color: 0x3d382f,
      roughness: 1,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
}

/** Light on the ground from a lit opening: added to what lies there, each patch at the strength
 * in its vertex colours, and out by day. */
export function spilled(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: generated("spill", "map"),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
}
