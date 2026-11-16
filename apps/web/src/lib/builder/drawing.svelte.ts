// What SceneCanvas draws and picks (ADR 20): the meshes kept in step with the geometry and the live
// glow, the first build in slices, and the hits of a click.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { untrack } from "svelte";
import { type Group, type PerspectiveCamera, type Scene as Studio, Vector3 } from "three";
import { cssColour } from "../scene/backdrop.ts";
import { pause } from "../scene/prepare.ts";
import type { Lit } from "../scene/stage.svelte.ts";
import { freeOverlay, overlay, type Tints } from "./overlay.ts";
import { Brush, type Brushing, type Painting, type Refused } from "./painting.ts";
import { ndc } from "./pointer.ts";
import type { Geometry, Ghost, Point } from "./pv.ts";
import { buildScene, buildSliced, strike, tint, toThree, type Hit, type Panel } from "./scene.ts";

export type { Hit, Panel } from "./scene.ts";

export { Handled, type Editing } from "./handles/handled.svelte.ts";

export { Surrounded, type Lie, type Stood } from "./surrounded.svelte.ts";

export { Arrivals } from "./arriving.svelte.ts";

export { paintingOf, type Painting } from "./gestures.ts";

export { editingOf } from "./editing.ts";

/** Pixels from the canvas's top left corner. */
export type Projector = (point: Point) => readonly [number, number] | null;

/** SceneCanvas's props, read when needed. */
export interface Source {
  readonly geometry: () => Geometry;
  readonly panels: () => readonly Panel[];
  readonly shares: () => readonly (number | null)[] | undefined;
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
  { geometry, panels, shares }: Source,
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
      place(buildScene(geometry(), panels()));

      return;
    }

    void (async () => {
      const next = await buildSliced(geometry(), panels(), pause);

      // A newer geometry came meanwhile and is built after it.
      if (build === builds) place(next);
    })();
  });

  // A live tick, a new sun or theme relights the modules it already drew: nothing rebuilt.
  ease(() => drawn, shares);

  return { drawn: () => drawn, built: built.promise };
}

/** What a click strikes besides the scene, and who is told. */
export interface Picked extends Pick<Source, "panels"> {
  readonly onpick: () => ((hit: Hit) => void) | undefined;
  /** The imported surroundings drawn around the scene. */
  readonly around: () => Group | undefined;
}

/** Further than this many pixels between press and release, the pointer orbited. */
const CLICK = 5;

/** Reports a click's hit; a press that moves further orbits instead. */
export function picking(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  drawn: () => Group | undefined,
  { panels, onpick, around }: Picked,
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

    const hit = strike(group, panels(), camera, ndc(canvas, event), around());

    if (hit !== null) pick(hit);
  };

  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointerup", release);

  return () => {
    canvas.removeEventListener("pointerdown", press);
    canvas.removeEventListener("pointerup", release);
  };
}

/** Keeps the overlay of what `painting` lays or wires in the studio, rebuilt with each step;
 * returns its removal. */
export function overlaid(
  studio: Studio,
  painting: () => Painting | undefined,
  render: () => void,
): () => void {
  let group: Group | undefined;
  let tints: { readonly key: string; readonly colours: Tints } | undefined;

  // Read on a new face or string only, as the handles: a drag rebuilds the overlay every step.
  const colours = (shown: Painting): Tints => {
    const key = shown.kind === "string" ? `string ${shown.string}` : `grid ${shown.grid}`;

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
    const shown = painting();

    untrack(() => {
      replace(shown && overlay(shown, colours(shown)));
      render();
    });
  });

  return () => {
    replace();
  };
}

/** What the brush shows on the canvas besides the scene, and the brush itself (painting.ts). */
export class Brushwork {
  /** Why the last module pressed refused the paint, until the next press. */
  refused = $state.raw<Refused>();

  /** The modules not laid yet, under the pointer on the selected face. */
  #ghosts = $state.raw<readonly Ghost[]>([]);

  /** `painting` with the ghosts under the pointer, for the overlay. */
  shown(painting: Painting | undefined): Painting | undefined {
    return painting?.kind === "modules" ? { ...painting, ghosts: this.#ghosts } : painting;
  }

  /** Lays modules on the selected face and wires the picked string; before the orbit controls. */
  attach(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    sources: Pick<Brushing, "painting" | "drawn" | "panels">,
  ): Brush {
    return new Brush(canvas, camera, {
      ...sources,
      onrefuse: (reason) => {
        this.refused = reason;
      },
      onghost: (lain) => {
        this.#ghosts = lain;
      },
    });
  }
}
