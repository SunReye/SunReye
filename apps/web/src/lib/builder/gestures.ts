// What a press on the drawn scene starts while a face is selected or a string picked (ADR 20): on
// free roof of the selected face it lays the ghost module or, dragged, a row; on one of its modules
// it moves that module, or selects it with a tap; with a string picked it wires the modules the
// pointer crosses, in that order, on any face.
import { haptics } from "../haptics.ts";
import { m } from "../paraglide/messages.js";
import type { Aim } from "./aim.ts";
import { paint, refuses, strokeOf, type Draft } from "./modules.ts";
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
import { wiring as pathOf } from "./wiring.ts";
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

/** The picked string, which a drag across modules wires. */
export interface Stringing extends Steps {
  readonly kind: "string";
  /** By position in the draft's strings. */
  readonly string: number;
  /** Its modules' centres along its wiring. */
  readonly path: readonly Point[];
}

export type Painting = Laying | Stringing;

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
  /** The latest painting: each step of a stroke paints onto the last. */
  readonly painting: () => Painting | undefined;
  /** The modules not laid yet, under the pointer. */
  readonly onghost: (ghosts: readonly Ghost[]) => void;
  /** Why a module refused the paint, beside the pointer; none clears it. */
  readonly onrefuse: (text?: string, at?: readonly [number, number]) => void;
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

/** What a press on a module starts while a string is picked: the modules the pointer crosses are
 * wired into it, or out of it where the press began on one of its own. */
export function wire(wiring: Stringing, aim: Aim, show: Showing): Press | null {
  const first = moduleUnder(aim.hit());

  if (first === null) return null;

  const stroke = strokeOf(wiring.draft.scene, first.grid, first.module, {
    kind: "paint",
    string: wiring.string,
  });

  let last = "";

  const cross = (at: Aim): void => {
    const under = moduleUnder(at.hit());
    const now = show.painting() ?? wiring;

    if (under === null || `${under.grid}.${under.module}` === last) return;

    last = `${under.grid}.${under.module}`;

    if (refuses(now.draft, under.grid, stroke)) {
      haptics.error();
      show.onrefuse(
        m.builder_refused_module_type({ name: wiring.draft.strings[wiring.string]?.name ?? "" }),
        at.at,
      );

      return;
    }

    haptics.selection();
    now.ondrag(paint(now.draft.scene, under.grid, under.module, stroke));
  };

  cross(aim);

  return {
    move: cross,
    drop: () => {
      (show.painting() ?? wiring).ondrop();
    },
    abort: () => {
      putBack(wiring);
    },
  };
}

/** What a painting reads besides the level: the draft's steps, the crate and its layout. */
export interface Brushed extends Steps {
  readonly laid: Modules;
  readonly pv: Pick<Pv, "lay" | "slide">;
  readonly sizes: Sizes;
  /** Drills the inspector to a tapped module. */
  readonly go: (level: Level) => void;
}

/** The selected face's grid as the crate lays modules on it, or the picked string; none for any
 * other level, or for a face without a grid. */
export function paintingOf(level: Level, brushed: Brushed): Painting | undefined {
  const { draft, laid, pv, sizes, ondrag, ondrop, go } = brushed;
  const steps = { draft, ondrag, ondrop };

  if (level.kind === "string") {
    const path = pathOf(draft.scene, laid.grids, level.index);

    return { ...steps, kind: "string", string: level.index, path };
  }

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
