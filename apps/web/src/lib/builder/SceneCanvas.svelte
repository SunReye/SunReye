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
  import { lit, type Lit } from "../scene/stage.svelte.ts";
  import type { View } from "./camera.ts";
  import type { Geometry } from "./pv.ts";
  import { buildScene, tint, toThree, type Panel } from "./scene.ts";

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
  } = $props();

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

  /** Keeps the drawn meshes in step with the geometry and the live glow. */
  function keep({ glow, show }: Lit, render: () => void): void {
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
    $effect(() => {
      if (shares !== undefined && drawn !== undefined) {
        tint(drawn, shares, glow());
        render();
      }
    });
  }

  /** Orbits the camera on a drag and reports the view once let go; follows the `view` given. */
  function orbit(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    render: () => void,
  ): OrbitControls {
    const controls = new OrbitControls(camera, canvas);

    controls.addEventListener("change", render);
    controls.addEventListener("end", () => {
      onview({ position: camera.position.toArray(), target: controls.target.toArray() });
    });

    $effect(() => {
      camera.position.set(...view.position);
      controls.target.set(...view.target);
      // Dispatches "change", which draws.
      controls.update();
    });

    return controls;
  }

  /** Draws on a change of geometry, view, sun or theme, a camera move or a resize, once per frame;
   * never in a loop (ADR 20). */
  function stage(canvas: HTMLCanvasElement): () => void {
    const camera = new PerspectiveCamera(40, 1, 0.1, 5000);
    let frame = 0;

    // Every change in a frame is drawn once, in the next one.
    const render = (): void => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        studio.render();
        onrender?.(projector(canvas, camera.clone()));
      });
    };

    const scene = lit(canvas, camera, () => sun ?? null, render);
    const { studio } = scene;
    const resize = fit(canvas, studio, camera, render);

    keep(scene, render);

    const parking = garage(
      studio.scene,
      render,
      untrack(() => model),
    );

    $effect(() => {
      parking.park(cars);
    });

    const controls = orbit(canvas, camera, render);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      parking.dispose();
      scene.dispose();
    };
  }
</script>

<canvas aria-label={m.builder_scene()} {@attach stage}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 20rem;
    touch-action: none;
  }
</style>
