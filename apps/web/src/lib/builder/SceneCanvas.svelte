<script lang="ts" module>
  import type { Point } from "./pv.ts";

  /** Pixels from the canvas's top left corner. */
  export type Projector = (point: Point) => readonly [number, number] | null;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { PerspectiveCamera, Vector3, type Group } from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { garage, type ModelLoader } from "../cars/garage.ts";
  import type { Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import { Ghost, lit, type Lit, type SceneFailure } from "../scene/stage.svelte.ts";
  import type { View } from "./camera.ts";
  import type { Geometry } from "./pv.ts";
  import { buildScene, strike, tint, toThree, type Hit, type Panel } from "./scene.ts";

  let {
    geometry,
    panels = [],
    shares,
    cars = [],
    sun = null,
    model,
    view,
    onview,
    onrender,
    onpick,
    onready,
    onerror,
  }: {
    geometry: Geometry;
    /** The placed modules. */
    panels?: readonly Panel[];
    /** Live, by panel, its string's share of peak; the modules' cells glow by it. */
    shares?: readonly (number | null)[];
    /** The connected cars; drawn again only when one comes, goes or changes body. */
    cars?: readonly Parked[];
    /** Toward the sun, east, north, up: it lights and shadows the scene; null for a fixed sun. */
    sun?: Point | null | undefined;
    /** Reads an uploaded car body. */
    model?: ModelLoader | undefined;
    view: View;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
    /** After each draw: where a point of the scene lands on the canvas, or null behind it. */
    onrender?: (project: Projector) => void;
    /** A click, not a drag: what it struck, if anything. */
    onpick?: ((hit: Hit) => void) | undefined;
    /** The first frame is drawn: nothing was before, so it never waited on a compile. */
    onready?: (() => void) | undefined;
    onerror?: ((reason: SceneFailure) => void) | undefined;
  } = $props();

  const ghost = new Ghost();

  function projector(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Projector {
    return (point) => {
      const at = new Vector3(...toThree(point)).project(camera);

      return at.z > 1
        ? null
        : [((at.x + 1) / 2) * canvas.clientWidth, ((1 - at.y) / 2) * canvas.clientHeight];
    };
  }

  /** Fits the drawing buffer and the camera to the canvas whenever its size changes. */
  function fit(
    canvas: HTMLCanvasElement,
    studio: Lit["studio"],
    camera: PerspectiveCamera,
    render: () => void,
  ): ResizeObserver {
    const resize = new ResizeObserver(() => {
      studio.setSize(canvas.clientWidth, canvas.clientHeight);
      camera.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      camera.updateProjectionMatrix();
      render();
    });

    resize.observe(canvas);

    return resize;
  }

  /** Keeps the drawn meshes in step with the geometry and the live glow; gives the ones drawn. */
  function keep({ glow, show, ease }: Lit, render: () => void): () => Group | undefined {
    let drawn: Group | undefined;

    $effect(() => {
      const next = buildScene(geometry, panels);

      show(next);
      drawn = next;
      untrack(() => {
        if (shares !== undefined) tint(next, shares, glow());
      });
      render();
    });

    // A live tick, a new sun or theme relights the modules it already drew: nothing rebuilt.
    ease(
      () => drawn,
      () => shares,
    );

    return () => drawn;
  }

  /** Further than this many pixels between press and release, the pointer orbited. */
  const CLICK = 5;

  /** Reports a click's hit; a press that moves further orbits instead. */
  function picking(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    drawn: () => Group | undefined,
  ): () => void {
    let down: readonly [number, number] | undefined;

    const press = (event: PointerEvent): void => {
      down = [event.clientX, event.clientY];
    };

    const release = (event: PointerEvent): void => {
      const group = drawn();

      if (down === undefined || group === undefined || onpick === undefined) return;

      const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]);

      down = undefined;

      if (moved > CLICK) return;

      // A click may come before the first draw has placed the camera's matrices.
      camera.updateMatrixWorld();

      const hit = strike(group, panels, camera, [
        (event.offsetX / canvas.clientWidth) * 2 - 1,
        1 - (event.offsetY / canvas.clientHeight) * 2,
      ]);

      if (hit !== null) onpick(hit);
    };

    canvas.addEventListener("pointerdown", press);
    canvas.addEventListener("pointerup", release);

    return () => {
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("pointerup", release);
    };
  }

  /** Flies the camera to each `view` given, from wherever it is; places the first at once. */
  function follow(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    flight: Lit["flight"],
    render: () => void,
  ): void {
    const place = ({ position, target }: View): void => {
      camera.position.set(...position);
      controls.target.set(...target);
      // Dispatches "change", which draws.
      controls.update();
    };

    let placed = false;

    $effect(() => {
      const to = view;

      untrack(() => {
        const from = { position: camera.position.toArray(), target: controls.target.toArray() };

        if (!placed) {
          placed = true;
          place(to);
        } else if (JSON.stringify(from) !== JSON.stringify(to)) {
          flight.fly(from, to, place);
          render();
        }
      });
    });
  }

  /** Orbits the camera on a drag and reports the view once let go. */
  function orbit(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    flight: Lit["flight"],
    render: () => void,
  ): OrbitControls {
    const controls = new OrbitControls(camera, canvas);

    controls.addEventListener("change", render);
    // The admin's hand takes the camera from a flight.
    controls.addEventListener("start", () => {
      flight.stop();
    });
    controls.addEventListener("end", () => {
      onview({ position: camera.position.toArray(), target: controls.target.toArray() });
    });
    follow(camera, controls, flight, render);

    return controls;
  }

  /** Parks the cars once `due`, each change after the last; their programs compiled first. */
  function parkLater(
    canvas: HTMLCanvasElement,
    opening: Lit["opening"],
    parking: ReturnType<typeof garage>,
  ) {
    let due = $state(false);
    let parked = Promise.resolve();

    $effect(() => {
      const arriving = cars;

      if (due) {
        parked = parked.then(() =>
          opening.arrive(canvas, ghost, () => {
            parking.park(arriving);
          }),
        );
      }
    });

    return {
      due: () => {
        due = true;
      },
      dispose: () => {
        parking.dispose();
      },
    };
  }

  /** The lit studio on `canvas`; null without WebGL2. */
  function studioOn(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Lit | null {
    try {
      return lit(
        canvas,
        camera,
        () => sun ?? null,
        () => onrender?.(projector(canvas, camera.clone())),
      );
    } catch {
      onerror?.("webgl2");

      return null;
    }
  }

  /** Draws on a change of geometry, view, sun or theme, a camera move or a resize; nothing before
   * the studio is prepared. Cars come once the house is on screen. */
  function stage(canvas: HTMLCanvasElement): () => void {
    const camera = new PerspectiveCamera(40, 1, 0.1, 5000);
    const scene = studioOn(canvas, camera);

    if (scene === null) return () => {};

    const { studio, flight, opening } = scene;
    const { render } = opening;
    const resize = fit(canvas, studio, camera, render);
    const unpick = picking(canvas, camera, keep(scene, render));

    const parking = parkLater(
      canvas,
      opening,
      garage(
        studio.scene,
        render,
        untrack(() => model),
      ),
    );

    const controls = orbit(canvas, camera, flight, render);

    opening
      .open(
        () => {
          onready?.();
        },
        () => {
          parking.due();
        },
      )
      .catch(() => {
        onerror?.("failed");
      });

    return () => {
      resize.disconnect();
      unpick();
      controls.dispose();
      parking.dispose();
      scene.dispose();
    };
  }
</script>

<div class="scene">
  <canvas aria-label={m.builder_scene()} {@attach stage}></canvas>
  <canvas
    bind:this={ghost.canvas}
    class={["ghost", ghost.phase, ghost.instant && "instant"]}
    ontransitionend={() => (ghost.phase = "off")}
    aria-hidden="true"
  ></canvas>
</div>

<style>
  .scene {
    position: relative;
    width: 100%;
    height: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 20rem;
    touch-action: none;
  }
  /* Opacity only (ADR 21): the picture without the new car goes, the car beneath it stays. */
  .ghost {
    position: absolute;
    inset: 0;
    min-height: 0;
    pointer-events: none;
    opacity: 0;
  }
  .ghost.hold {
    opacity: 1;
  }
  .ghost.fade {
    transition: opacity 350ms var(--motion-ease, ease-out);
  }
  .ghost.instant {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .ghost.fade {
      transition: none;
    }
  }
</style>
