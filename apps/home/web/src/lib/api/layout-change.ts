// A layout change as the builder makes it and as the core's client sends it (ADR 17, 20).
import type { LayoutChange } from "@sunreye/builder/frame";
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

type SentBlock = components["schemas"]["Block"];

/** A block as the client sends it, its free-form roof and traced lines copied. */
function blockOf({ freeForm, ...block }: LayoutChange["scene"]["blocks"][number]): SentBlock {
  const traced = freeForm?.traced;

  return {
    ...block,
    ...(freeForm && {
      freeForm: {
        footprint: freeForm.footprint.map((corner) => [...corner]),
        faces: freeForm.faces.map((face) => face.map((corner) => [...corner])),
        ...(traced && {
          traced: {
            points: traced.points.map((point) => [...point]),
            ...(traced.set && { set: [...traced.set] }),
            lines: traced.lines.map((line) => [...line]),
            faces: traced.faces.map((face) => face.slice()),
          },
        }),
      },
    }),
  };
}

type Sent = components["schemas"]["Scene"];

/** `list` copied; none for one stored without it. */
const copied = <T>(list: readonly T[] | undefined): T[] => [...(list ?? [])];

/** What stands on the roofs and the plot, each list copied. */
function roofsAndPlot(
  scene: LayoutChange["scene"],
): Pick<
  Sent,
  | "equipment"
  | "carPlaces"
  | "chimneys"
  | "surfaces"
  | "fences"
  | "openings"
  | "roofWindows"
  | "faceDetails"
  | "existingPv"
> {
  return {
    equipment: copied(scene.equipment),
    carPlaces: copied(scene.carPlaces),
    chimneys: copied(scene.chimneys),
    surfaces: copied(scene.surfaces),
    fences: copied(scene.fences).map(({ points, height, finish }) => ({
      points: [...points],
      height,
      finish,
    })),
    openings: copied(scene.openings),
    roofWindows: copied(scene.roofWindows),
    faceDetails: copied(scene.faceDetails),
    existingPv: copied(scene.existingPv),
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
      blocks: scene.blocks.map((block) => blockOf(block)),
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
      ...roofsAndPlot(scene),
    },
  };
}
