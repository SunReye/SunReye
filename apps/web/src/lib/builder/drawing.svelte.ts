// What SceneCanvas draws and picks (ADR 20): the meshes kept in step with the geometry and the live
// glow, the first build in slices, and the hits of a click.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { untrack } from "svelte";
import { type Group, type PerspectiveCamera, Vector3 } from "three";
import { pause } from "../scene/prepare.ts";
import type { Lit } from "../scene/stage.svelte.ts";
import type { Geometry, Point } from "./pv.ts";
import { buildScene, buildSliced, strike, tint, toThree, type Hit, type Panel } from "./scene.ts";

export type { Hit, Panel } from "./scene.ts";

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
