// What SceneCanvas draws and picks (ADR 20): the meshes kept in step with the geometry and the live
// glow, the first build in slices, and the hits of a click.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { untrack } from "svelte";
import { type Group, type PerspectiveCamera, type Scene as Studio, Vector3 } from "three";
import { cssColour } from "../scene/backdrop.ts";
import { pause } from "../scene/prepare.ts";
import type { Lit } from "../scene/stage.svelte.ts";
import { freeOverlay, overlay, type Tints } from "./overlay.ts";
import { RoofPress, type RoofSources, type Roofwork } from "./roof-press.ts";
import type { Around, Geometry, Ghost, Point } from "./pv.ts";
import { buildScene, buildSliced, strike, tint, toThree, type Hit, type Panel } from "./scene.ts";

export type { Hit, Panel } from "./scene.ts";

export type { Around } from "./pv.ts";

export { Handled, type Editing } from "./handles/handled.svelte.ts";

export { layingOf, type Roofwork } from "./gestures.ts";

/** Pixels from the canvas's top left corner. */
export type Projector = (point: Point) => readonly [number, number] | null;

/** SceneCanvas's props, read when needed. */
export interface Source {
  readonly geometry: () => Geometry;
  readonly panels: () => readonly Panel[];
  readonly shares: () => readonly (number | null)[] | undefined;
  /** The live values have stalled or are lost: the shares step to each tick. */
  readonly halted: () => boolean;
  /** What the builder's consumer supplies around the plant. */
  readonly around: () => Around | undefined;
}

export interface Kept {
  readonly drawn: () => Group | undefined;
  /** The first build is shown. */
  readonly built: Promise<void>;
}

export function projector(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Projector {
  return (point) => {
    const at = new Vector3(...toThree(point)).project(camera);

    return at.z > 1
      ? null
      : [((at.x + 1) / 2) * canvas.clientWidth, ((1 - at.y) / 2) * canvas.clientHeight];
  };
}

/** Keeps the drawn meshes in step with the geometry and the live glow: the first build in
 * slices, behind the dashboard (ADR 20 Loading), each after it at once. */
export function keep(
  { glow, show, ease }: Lit,
  { geometry, panels, shares, halted, around }: Source,
  render: () => void,
): Kept {
  let drawn: Group | undefined;
  let builds = 0;
  const built = Promise.withResolvers<void>();

  const place = (next: Group): void => {
    show(next);
    drawn = next;
    untrack(() => {
      const live = shares();

      if (live !== undefined) tint(next, live, glow());
    });
    built.resolve();
    render();
  };

  $effect(() => {
    const build = (builds += 1);

    if (drawn !== undefined) {
      place(buildScene(geometry(), panels(), around()));

      return;
    }

    void (async () => {
      const next = await buildSliced(geometry(), panels(), pause, around());

      // A newer geometry came meanwhile and is built after it.
      if (build === builds) place(next);
    })();
  });

  // A live tick, a new sun or theme relights the modules it already drew: nothing rebuilt.
  ease(() => drawn, shares, halted);

  return { drawn: () => drawn, built: built.promise };
}

/** Further than this many pixels between press and release, the pointer orbited. */
const CLICK = 5;

/** Reports a click's hit; a press that moves further orbits instead. */
export function picking(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  drawn: () => Group | undefined,
  { panels, onpick }: Pick<Source, "panels"> & { onpick: () => ((hit: Hit) => void) | undefined },
): () => void {
  let down: readonly [number, number] | undefined;

  const press = (event: PointerEvent): void => {
    down = [event.clientX, event.clientY];
  };

  const release = (event: PointerEvent): void => {
    const group = drawn();

    const pick = onpick();

    if (down === undefined || group === undefined || pick === undefined) return;

    const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]);

    down = undefined;

    if (moved > CLICK) return;

    // A click may come before the first draw has placed the camera's matrices.
    camera.updateMatrixWorld();

    const hit = strike(group, panels(), camera, [
      (event.offsetX / canvas.clientWidth) * 2 - 1,
      1 - (event.offsetY / canvas.clientHeight) * 2,
    ]);

    if (hit !== null) pick(hit);
  };

  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointerup", release);

  return () => {
    canvas.removeEventListener("pointerdown", press);
    canvas.removeEventListener("pointerup", release);
  };
}

/** Keeps the overlay of what `roofwork` lays or wires in the studio, rebuilt with each step;
 * returns its removal. */
export function overlaid(
  studio: Studio,
  roofwork: () => Roofwork | undefined,
  render: () => void,
): () => void {
  let group: Group | undefined;
  let tints: { readonly key: string; readonly colours: Tints } | undefined;

  // Read on a new face or string only, as the handles: a drag rebuilds the overlay every step.
  const colours = (shown: Roofwork): Tints => {
    const key = shown.kind === "wiring" ? "wiring" : `grid ${shown.grid}`;

    if (tints?.key !== key) {
      const brand = cssColour("var(--brand)");

      tints = { key, colours: { brand, unfit: cssColour("var(--destructive)") } };
    }

    return tints.colours;
  };

  const replace = (next?: Group): void => {
    if (group !== undefined) {
      studio.remove(group);
      freeOverlay(group);
    }

    group = next;

    if (next !== undefined) studio.add(next);
  };

  $effect(() => {
    const shown = roofwork();

    untrack(() => {
      replace(shown && overlay(shown, colours(shown)));
      render();
    });
  });

  return () => {
    replace();
  };
}

/** What a press on the roof shows on the canvas besides the scene, and the press itself
 * (roof-press.ts). */
export class RoofTool {
  /** The modules not laid yet, under the pointer on the selected face. */
  #ghosts = $state.raw<readonly Ghost[]>([]);

  /** `roofwork` with the ghosts under the pointer, for the overlay. */
  shown(roofwork: Roofwork | undefined): Roofwork | undefined {
    return roofwork?.kind === "modules" ? { ...roofwork, ghosts: this.#ghosts } : roofwork;
  }

  /** Lays modules on the selected face and selects them for wiring; before the orbit controls. */
  attach(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    sources: Pick<RoofSources, "roofwork" | "drawn" | "panels">,
  ): RoofPress {
    return new RoofPress(canvas, camera, {
      ...sources,
      onghost: (lain) => {
        this.#ghosts = lain;
      },
    });
  }
}
