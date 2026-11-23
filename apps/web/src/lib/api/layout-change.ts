// A layout change as the builder makes it and as the core's client sends it (ADR 17, 20).
import type { Scene } from "../builder/pv";
import type { StringDraft } from "./core";
import type { components } from "./schema";

/** The inverter and battery types the layout's devices carry, by device id (ADR 27); the builder
 * never writes them. */
export interface Types {
  readonly inverterTypes?: Readonly<
    Record<
      string,
      Readonly<Omit<components["schemas"]["InverterType"], "inputs">> & {
        readonly inputs: readonly Readonly<components["schemas"]["MpptInput"]>[];
      }
    >
  >;
  readonly batteryTypes?: Readonly<Record<string, Readonly<components["schemas"]["BatteryType"]>>>;
}

/** A layout change with its scene; its modules name their string by position in `strings`. */
export interface LayoutChange {
  /** RFC 3339. */
  readonly appliesFrom: string;
  readonly strings: readonly Readonly<StringDraft>[];
  readonly scene: Scene;
  /** Kept as the layout in force has them: a change without them removes them. */
  readonly types?: Types | undefined;
}

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
      blocks: [...scene.blocks],
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
