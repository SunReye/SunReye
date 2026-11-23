// A layout change as the builder makes it and as the core's client sends it (ADR 17, 20).
import type { LayoutChange } from "@sunreye/builder/builder/host.ts";
import type { Types } from "@sunreye/scene";
import type { components } from "./schema";

export type { LayoutChange };

/** Only the types of `layout`, which may be a whole layout: the core refuses a member it does not
 * know. */
export function typesOf({ inverterTypes, batteryTypes }: Types): components["schemas"]["Types"] {
  const inverters: Record<string, components["schemas"]["InverterType"]> = {};

  for (const [device, type] of Object.entries(inverterTypes ?? {})) {
    inverters[device] = { ...type, inputs: [...type.inputs] };
  }

  return {
    ...(inverterTypes !== undefined && { inverterTypes: inverters }),
    ...(batteryTypes !== undefined && { batteryTypes: { ...batteryTypes } }),
  };
}

/** The change as the client sends it. */
export function body({
  appliesFrom,
  strings,
  scene,
  types,
}: LayoutChange): components["schemas"]["LayoutChange"] {
  return {
    ...typesOf(types ?? {}),
    appliesFrom,
    strings: [...strings],
    scene: {
      north: scene.north,
      blocks: scene.blocks.map(({ freeForm, ...block }) => ({
        ...block,
        ...(freeForm && {
          freeForm: {
            footprint: freeForm.footprint.map((corner) => [...corner]),
            faces: freeForm.faces.map((face) => face.map((corner) => [...corner])),
          },
        }),
      })),
      obstacles: [...scene.obstacles],
      grids: (scene.grids ?? []).map(
        ({ block, face, moduleType, landscape, setback, modules }) => ({
          block,
          face,
          moduleType,
          landscape,
          setback,
          modules: [...modules],
        }),
      ),
      equipment: [...(scene.equipment ?? [])],
      carPlaces: [...(scene.carPlaces ?? [])],
      chimneys: [...(scene.chimneys ?? [])],
      surfaces: [...(scene.surfaces ?? [])],
      fences: (scene.fences ?? []).map(({ points, height, finish }) => ({
        points: [...points],
        height,
        finish,
      })),
      openings: [...(scene.openings ?? [])],
    },
  };
}
