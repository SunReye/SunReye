// What a press on the drawn scene starts while a face is selected or in the wiring mode (ADR 20):
// on free roof of the selected face it lays the ghost module or, dragged, a row; on one of its
// modules it moves that module, or selects it with a tap; in the wiring mode it selects the modules
// the pointer crosses, in that order, on any face.
import { haptics } from "@sunreye/ui/haptics";
import type { Aim } from "./aim.ts";
import type { Draft } from "./modules.ts";
import { move, place } from "./placing.ts";
import { faceGrid, laying as roofOf, type Level } from "./levels.ts";
import type {
  Footprint,
  Ghost,
  LaidGrid,
  Modules,
  Point,
  Pv,
  RoofFace,
  Scene,
  Sizes,
} from "./pv.ts";
import { sameCell, type Cell } from "./selecting.ts";
import type { Hit } from "./strike.ts";

export interface Steps {
  readonly draft: Draft;
  /** Each step, shown at once. */
  readonly ondrag: (scene: Scene) => void;
  /** Let go: one undo step. */
  readonly ondrop: () => void;
}

/** A selected face's module grid, as the crate lays modules on it. */
export interface Laying extends Steps {
  readonly kind: "modules";
  /** By position in the scene's grids. */
  readonly grid: number;
  readonly roof: RoofFace;
  /** The roof modules may not lie on. */
  readonly shade: LaidGrid;
  /** The selected module's footprint. */
  readonly selected?: Footprint | undefined;
  /** The modules not laid yet, under the pointer. */
  readonly ghosts?: readonly Ghost[];
  /** What a press at `from` dragged to `to` would lay on `scene`'s grid; null off its face. */
  readonly lay: (scene: Scene, from: Point, to: Point) => Ghost[] | null;
  /** Where module `module` of `scene`'s grid dragged from `from` to `to` would lie. */
  readonly slide: (scene: Scene, module: number, from: Point, to: Point) => Ghost | null;
  /** A tap on a module of the grid, by its position in it. */
  readonly onselect: (module: number) => void;
}

/** The wiring mode: every string's wiring is drawn and a drag across modules selects them. */
export interface Selecting {
  readonly kind: "wiring";
  /** Each string's modules' centres along its wiring, by the string's position. */
  readonly paths: readonly (readonly Point[])[];
  /** The selected modules, in the order they were crossed. */
  readonly selection: readonly Cell[];
  /** Their footprints, in that order. */
  readonly chosen: readonly Footprint[];
  readonly onselect: (selection: readonly Cell[]) => void;
}

export type Roofwork = Laying | Selecting;

/** A press that became a gesture: where its moves and its end go. */
export interface Press {
  readonly move: (aim: Aim) => void;
  /** Let go; a `tap` never left where it pressed. */
  readonly drop: (tap: boolean) => void;
  /** A second finger takes the canvas: what the gesture did is put back, unrecorded. */
  readonly abort: () => void;
}

/** What a gesture shows besides the scene. */
export interface Showing {
  /** The modules not laid yet, under the pointer. */
  readonly onghost: (ghosts: readonly Ghost[]) => void;
}

/** Puts the scene back as it was, unrecorded. */
function putBack({ draft, ondrag, ondrop }: Steps): void {
  ondrag(draft.scene);
  ondrop();
}

/** A drag across free roof: the row the crate lays along it, placed where it fits on release. */
function row(laying: Laying, from: Point, first: readonly Ghost[], show: Showing): Press {
  const { scene } = laying.draft;
  let ghosts = first;

  show.onghost(ghosts);

  return {
    move: (aim) => {
      const to = aim.onFace(laying.roof);

      ghosts = (to && laying.lay(scene, from, to)) ?? ghosts;
      show.onghost(ghosts);
    },
    drop: () => {
      const fitting = ghosts.filter(({ fits }) => fits);

      show.onghost([]);

      if (fitting.length === 0) {
        haptics.error();

        return;
      }

      haptics.selection();
      laying.ondrag(place(scene, laying.grid, fitting));
      laying.ondrop();
    },
    abort: () => {
      show.onghost([]);
    },
  };
}

/** A drag from a module: it follows the pointer, held at the last place it fits; a tap selects. */
function carry(laying: Laying, module: number, from: Point): Press {
  const { scene } = laying.draft;

  return {
    move: (aim) => {
      const to = aim.onFace(laying.roof);
      const ghost = to && laying.slide(scene, module, from, to);

      if (ghost?.fits === true) {
        laying.ondrag(move(scene, laying.grid, module, { across: ghost.across, up: ghost.up }));
      }
    },
    drop: (tap) => {
      if (!tap) {
        laying.ondrop();

        return;
      }

      putBack(laying);
      haptics.soft();
      laying.onselect(module);
    },
    abort: () => {
      putBack(laying);
    },
  };
}

/** A press on a module: one of the selected face's grid is carried along. */
function grabbed(laying: Laying, aim: Aim, hit: Extract<Hit, { kind: "grid" }>): Press | null {
  const grab = hit.grid === laying.grid ? aim.onFace(laying.roof) : null;

  return grab === null || hit.module === undefined ? null : carry(laying, hit.module, grab);
}

/** What a press on the selected face starts; null for a press anywhere else, which orbits. */
export function lay(laying: Laying, aim: Aim, show: Showing): Press | null {
  const hit = aim.hit();

  if (hit?.kind === "grid") return grabbed(laying, aim, hit);

  if (hit?.kind !== "point") return null;

  const first = laying.lay(laying.draft.scene, hit.point, hit.point);

  return first === null ? null : row(laying, hit.point, first, show);
}

/** The ghost module under a pointer that hovers over the selected face's free roof. */
export function hover(laying: Laying, aim: Aim): readonly Ghost[] {
  const hit = aim.hit();

  const lain = hit?.kind === "point" ? laying.lay(laying.draft.scene, hit.point, hit.point) : null;

  return lain ?? [];
}

/** A module the strike landed on, on any face. */
function moduleUnder(hit: Hit | null): { readonly grid: number; readonly module: number } | null {
  return hit?.kind === "grid" && hit.module !== undefined
    ? { grid: hit.grid, module: hit.module }
    : null;
}

/** What a press on a module starts in the wiring mode: it and the modules the pointer crosses
 * join the selection in that order; a tap on a selected one takes it out. */
export function select(mode: Selecting, aim: Aim): Press | null {
  const first = moduleUnder(aim.hit());

  if (first === null) return null;

  const before = mode.selection;
  const held = before.some((cell) => sameCell(cell, first));
  let now = held ? before : [...before, first];

  haptics.selection();
  mode.onselect(now);

  return {
    move: (at) => {
      const under = moduleUnder(at.hit());

      if (under === null || now.some((cell) => sameCell(cell, under))) return;

      now = [...now, under];
      haptics.selection();
      mode.onselect(now);
    },
    drop: (tap) => {
      if (tap && held) mode.onselect(before.filter((cell) => !sameCell(cell, first)));
    },
    abort: () => {
      mode.onselect(before);
    },
  };
}

/** What laying reads besides the level: the draft's steps, the crate and its layout. */
export interface LaySteps extends Steps {
  readonly laid: Modules;
  readonly pv: Pick<Pv, "lay" | "slide">;
  readonly sizes: Sizes;
  /** Drills the inspector to a tapped module. */
  readonly go: (level: Level) => void;
}

/** The selected face's grid as the crate lays modules on it; none for any other level, or for a
 * face without a grid. */
export function layingOf(level: Level, roofSources: LaySteps): Laying | undefined {
  const { draft, laid, pv, sizes, ondrag, ondrop, go } = roofSources;
  const steps = { draft, ondrag, ondrop };

  if (level.kind !== "face" && level.kind !== "module") return undefined;

  const face = faceGrid(draft.scene, laid, level);
  const roof = roofOf(laid.roofs, level);

  if (face === null || roof === undefined) return undefined;

  const on = (scene: Scene) => ({ scene, sizes, grid: face.grid });

  return {
    ...steps,
    ...face,
    kind: "modules",
    roof,
    lay: (scene, from, to) => pv.lay(on(scene), from, to),
    slide: (scene, module, from, to) => pv.slide(on(scene), module, from, to),
    onselect: (module) => {
      go({ kind: "module", block: level.block, face: level.face, module });
    },
  };
}
