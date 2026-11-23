<script lang="ts" module>
  export type { Plant, SceneWeather } from "../scene/weather.ts";

  export type { Around, Editing, Roofwork, Projector } from "./drawing.svelte.ts";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { PerspectiveCamera } from "three";
  import {
    openGarage,
    parkedKey,
    type Garage,
    type ModelLoader,
    type Parked,
  } from "../cars/garage.ts";
  import { m } from "../paraglide/messages.js";
  import PerfOverlay from "../scene/PerfOverlay.svelte";
  import { Ghost, lit, type Lit, type SceneFailure, type Sky } from "../scene/stage.svelte.ts";
  import { FOV, type View } from "./camera.ts";
  import { fit, orbit } from "./orbit.svelte.ts";
  import type { Geometry, Point } from "./pv.ts";
  import {
    RoofTool,
    Handled,
    keep,
    overlaid,
    picking,
    projector,
    type Around,
    type Editing,
    type Hit,
    type Roofwork,
    type Panel,
    type Projector,
  } from "./drawing.svelte.ts";

  let {
    geometry,
    panels = [],
    around,
    shares,
    halted = false,
    cars = [],
    sun = null,
    diffuse = null,
    weather,
    model,
    view,
    locked = false,
    onview,
    onrender,
    onpick,
    onready,
    onerror,
    editing,
    roofwork,
  }: {
    geometry: Geometry;
    /** The placed modules. */
    panels?: readonly Panel[];
    /** The aerial image and the neighbours the builder's consumer supplies; none in Home. */
    around?: Around | undefined;
    /** Live, by panel, its string's share of peak; the modules' cells glow by it. */
    shares?: readonly (number | null)[];
    /** The live values have stalled or are lost: the glow steps to each tick (ADR 21). */
    halted?: boolean;
    /** The connected cars; drawn again only when one comes, goes or changes body. */
    cars?: readonly Parked[];
    /** Toward the sun, east, north, up: it lights and shadows the scene; null for a fixed sun. */
    sun?: Point | null | undefined;
    /** How diffuse the sky's light is, 0 clear to 1 overcast: the weather; null for a clear sky. */
    diffuse?: number | null | undefined;
    /** Fog, wet ground, lying snow and thunder at the instant shown (ADR 23); none, clear and dry. */
    weather?: Sky["weather"];
    /** Reads an uploaded car body. */
    model?: ModelLoader | undefined;
    view: View;
    /** The camera stays put and a finger on the canvas scrolls the page (ADR 20). */
    locked?: boolean;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
    /** After each draw: where a point of the scene lands on the canvas, or null behind it. */
    onrender?: ((project: Projector) => void) | undefined;
    /** A click, not a drag: what it struck, if anything. */
    onpick?: ((hit: Hit) => void) | undefined;
    /** The first frame is drawn: nothing was before, so it never waited on a compile. */
    onready?: (() => void) | undefined;
    onerror?: ((reason: SceneFailure) => void) | undefined;
    /** The selected object's handles and where their drags go; none, nothing is handled. */
    editing?: Editing | undefined;
    /** The selected face, whose roof a press lays modules on, or the picked string, which a drag
     * across modules wires. */
    roofwork?: Roofwork | undefined;
  } = $props();

  const roofTool = new RoofTool();

  const handled = new Handled();

  const ghost = new Ghost();

  const source = {
    geometry: () => geometry,
    panels: () => panels,
    shares: () => shares,
    halted: () => halted,
    around: () => around,
  };

  const orbiting = { view: () => view, locked: () => locked, onview: (to: View) => onview(to) };

  /** Parks the cars once `due`, each change after the last; the default body loaded and their
   * programs compiled first. No car is drawn when the body cannot be read. A live tick that moves
   * only power or SOC brings nothing: an arrival snapshots the canvas, a stutter on every tick. */
  function parkLater(
    canvas: HTMLCanvasElement,
    opening: Lit["opening"],
    open: () => Promise<Garage>,
  ) {
    let due = $state(false);
    let parking: Promise<Garage | null> | undefined;
    let parked: Promise<unknown> = Promise.resolve();
    let brought = parkedKey([]);

    $effect(() => {
      const arriving = cars;
      const key = parkedKey(arriving);

      if (due && key !== brought) {
        brought = key;
        parking ??= open().catch(() => null);
        parked = parked
          .then(() => parking)
          .then(
            (ready) =>
              ready &&
              opening.arrive(canvas, ghost, () => {
                ready.park(arriving);
              }),
          )
          .catch(() => {});
      }
    });

    return {
      due: () => {
        due = true;
      },
      dispose: () => {
        void parking?.then((ready) => ready?.dispose());
      },
    };
  }

  /** The lit studio on `canvas`; null without WebGL2. */
  function studioOn(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Lit | null {
    try {
      return lit(
        canvas,
        camera,
        () => ({ sun: sun ?? null, diffuse: diffuse ?? null, weather }),
        () => {
          const project = projector(canvas, camera.clone());

          handled.place(project);
          onrender?.(project);
        },
        () => editing !== undefined || roofwork !== undefined,
      );
    } catch {
      onerror?.("webgl2");

      return null;
    }
  }

  /** Draws on a change of geometry, view, sun or theme, a camera move or a resize; nothing before
   * the studio is prepared. Cars come once the house is on screen. */
  function stage(canvas: HTMLCanvasElement): () => void {
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 5000);
    const scene = studioOn(canvas, camera);

    if (scene === null) return () => {};

    const { studio, flight, opening } = scene;
    const { render } = opening;
    const resize = fit(canvas, studio, camera, render);
    const kept = keep(scene, source, render);
    const handling = { editing: () => editing, drawn: kept.drawn, panels: source.panels };
    // Before the picking and the orbit controls: a press on a handle never reaches them.
    const unhandle = handled.attach(canvas, camera, studio.scene, handling, render);
    const unlay = overlaid(studio.scene, () => roofTool.shown(roofwork), render);
    const roofSources = { roofwork: () => roofwork, drawn: kept.drawn, panels: source.panels };
    const roofPress = roofTool.attach(canvas, camera, roofSources);

    const unpick = picking(canvas, camera, kept.drawn, {
      panels: source.panels,
      onpick: () => onpick,
    });

    const parking = parkLater(canvas, opening, () =>
      openGarage(
        studio.scene,
        // A car that parks, leaves or changes body casts another shadow.
        opening.recast,
        untrack(() => model),
      ),
    );

    const controls = orbit(canvas, camera, flight, render, orbiting);

    opening
      .open(kept.built, () => onready?.(), parking.due)
      .catch(() => {
        onerror?.("failed");
      });

    return () => {
      resize.disconnect();
      unhandle();
      roofPress.dispose();
      unlay();
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
  <PerfOverlay />
  {#if handled.label !== undefined}
    {@const { text, left, top } = handled.label}
    <!-- The same canvas chip as the live scene's labels; it never takes the pointer. -->
    <output
      class="canvas-chip pointer-events-none absolute flex h-7 translate-x-3.5 -translate-y-1/2 items-center rounded-md px-2 text-xs whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
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
    transition: opacity var(--motion-enter) var(--motion-ease);
  }
  .ghost.instant {
    transition: none;
  }
</style>
