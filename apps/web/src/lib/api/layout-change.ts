// A layout change as the builder makes it and as the core's client sends it (ADR 17, 20).
import type { Scene } from "../builder/pv";
import type { StringDraft } from "./core";
import type { components } from "./schema";

/** A layout change with its scene; its modules name their string by position in `strings`. */
export interface LayoutChange {
  /** RFC 3339. */
  readonly appliesFrom: string;
  readonly strings: readonly Readonly<StringDraft>[];
  readonly scene: Scene;
}

/** The change as the client sends it. */
export function body({
  appliesFrom,
  strings,
  scene,
}: LayoutChange): components["schemas"]["LayoutChange"] {
  return {
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
    },
  };
}
