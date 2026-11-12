<script lang="ts" module>
  export type { Editing, Projector } from "./drawing.svelte.ts";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { PerspectiveCamera } from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { garage, type ModelLoader } from "../cars/garage.ts";
  import type { Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import { Ghost, lit, type Lit, type SceneFailure } from "../scene/stage.svelte.ts";
  import type { View } from "./camera.ts";
  import {
    Handled,
    keep,
    picking,
    projector,
    type Editing,
    type Hit,
    type Panel,
    type Projector,
  } from "./drawing.svelte.ts";
  import type { Geometry, Point } from "./pv.ts";

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
    editing,
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
    /** The selected object's handles and where their drags go; none, nothing is handled. */
    editing?: Editing | undefined;
  } = $props();

  const handled = new Handled();

  const ghost = new Ghost();

  const source = {
    geometry: () => geometry,
    panels: () => panels,
    shares: () => shares,
  };

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
        () => {
          const project = projector(canvas, camera.clone());

          handled.place(project);
          onrender?.(project);
        },
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
    const kept = keep(scene, source, render);
    const handling = { editing: () => editing, drawn: kept.drawn, panels: source.panels };
    // Before the picking and the orbit controls: a press on a handle never reaches them.
    const unhandle = handled.attach(canvas, camera, studio.scene, handling, render);

    const unpick = picking(canvas, camera, kept.drawn, {
      panels: source.panels,
      onpick: () => onpick,
    });

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

    opening.open(kept.built, () => onready?.(), parking.due).catch(() => {
      onerror?.("failed");
    });

    return () => {
      resize.disconnect();
      unhandle();
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
  {#if handled.label !== undefined}
    {@const { text, left, top } = handled.label}
    <!-- The same ambient glass chip as the live scene's labels; it never takes the pointer. -->
    <output
      class="glass-ambient pointer-events-none absolute flex h-7 translate-x-3.5 -translate-y-1/2 items-center rounded-md px-2 text-xs whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
      style:left="{left}px"
      style:top="{top}px">{text}</output
    >
  {/if}
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
