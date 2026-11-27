<script lang="ts" module>
  export type { Plant, SceneWeather } from "../scene/weather.ts";

  export type { Around, Editing, Roofwork, Projector } from "./drawing.svelte.ts";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { Group } from "three";
  import { parkLater, type ModelLoader, type Parked } from "../cars/park-later.svelte.ts";
  import PerfOverlay from "../scene/PerfOverlay.svelte";
  import { Ghost, lit, type Lit, type SceneFailure, type Sky } from "../scene/stage.svelte.ts";
  import type { View } from "./camera.ts";
  import { fit, lensOf, orbit, type Lens } from "./orbit.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import type { Geometry, Point, RoofFace } from "./pv.ts";
  import {
    RoofTool,
    Handled,
    keep,
    marked,
    overlaid,
    picking,
    pointing,
    projector,
    selector,
    sight,
    TraceLayer,
    TracePress,
    TraceTool,
    type Around,
    type Editing,
    type Hit,
    type Navigation,
    type OnContext,
    type OnPress,
    type Roofwork,
    type Panel,
    type Projector,
    type Seen,
    type Tracing,
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
    label = m.builder_scene(),
    locked = false,
    onview,
    onrender,
    onpick,
    roofs,
    selected,
    onselect,
    onready,
    onerror,
    editing,
    roofwork,
    tracing,
    navigation = "orbit",
    oncontext,
    onpress,
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
    /** The canvas's accessible name: two views of one scene tell themselves apart by it. */
    label?: string;
    /** The camera stays put and a finger on the canvas scrolls the page (ADR 20). */
    locked?: boolean;
    /** The view the admin orbited to, once they let go. */
    onview: (view: View) => void;
    /** After each draw: where a point of the scene lands on the canvas, or null behind it. */
    onrender?: ((project: Projector) => void) | undefined;
    /** A click, not a drag: what it struck, if anything. */
    onpick?: ((hit: Hit) => void) | undefined;
    /** The crate's roof faces of the scene: what a click on a roof selects, and what is marked. */
    roofs?: readonly RoofFace[] | undefined;
    /** The `@sunreye/scene` key of the face marked selected; two views of one scene take one. */
    selected?: string | undefined;
    /** A click, not a drag: the roof face it struck, by block and face; null off every roof. */
    onselect?: ((face: Pick<RoofFace, "block" | "face"> | null) => void) | undefined;
    /** The first frame is drawn: nothing was before, so it never waited on a compile. */
    onready?: (() => void) | undefined;
    onerror?: ((reason: SceneFailure) => void) | undefined;
    /** The selected object's handles and where their drags go; none, nothing is handled. */
    editing?: Editing | undefined;
    /** The selected face, whose roof a press lays modules on, or the picked string, which a drag
     * across modules wires. */
    roofwork?: Roofwork | undefined;
    /** The tracing mode: seen from above, clicks trace a roof's lines over what is drawn, the
     * aerial image included, and each edit's next scene goes to `ontrace` (ADR 20). */
    tracing?: Tracing | undefined;
    /** What the pointer does to the camera and shows on hover; read when the canvas is made. */
    navigation?: Navigation;
    /** A right click or a long press, not a drag: what it struck, its face, and where on the page. */
    oncontext?: OnContext | undefined;
    onpress?: OnPress | undefined;
  } = $props();

  const traceTool = new TraceTool(() => tracing);

  /** Where a point of the scene lands on the canvas, as last drawn. */
  let projected = $state.raw<Projector>();

  /** What the camera saw past the house, as last drawn. */
  let seen = $state.raw<Seen>();

  /** The house as drawn, once the studio keeps it. */
  let house: (() => Group | undefined) | undefined;

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

  /** The lit studio on `canvas`; null without WebGL2. */
  function studioOn(canvas: HTMLCanvasElement, camera: Lens): Lit | null {
    try {
      return lit(
        canvas,
        camera,
        () => ({ sun: sun ?? null, diffuse: diffuse ?? null, weather }),
        () => {
          const project = projector(canvas, camera.clone());

          handled.place(project);
          projected = project;
          seen = tracing && sight(camera.clone(), house?.());
          onrender?.(project);
        },
        () => editing !== undefined || roofwork !== undefined || tracing !== undefined,
      );
    } catch {
      onerror?.("webgl2");

      return null;
    }
  }

  /** Answers a click with its hit and the roof face it selects, and marks the selected face. */
  function selecting(
    canvas: HTMLCanvasElement,
    camera: Lens,
    { studio, opening }: Lit,
    drawn: () => Group | undefined,
  ): () => void {
    const unpick = picking(canvas, camera, drawn, {
      panels: source.panels,
      onpick: selector({
        roofs: () => roofs,
        panels: source.panels,
        onpick: () => onpick,
        onselect: () => onselect,
      }),
    });

    const unmark = marked(
      studio.scene,
      () => roofs,
      () => selected,
      opening.render,
    );

    const unpoint = pointing(canvas, camera, studio.scene, opening.render, {
      navigation: untrack(() => navigation),
      drawn,
      panels: source.panels,
      props: () => ({ roofs, selected, editing, tracing, oncontext, onpress }),
    });

    return () => {
      unpick();
      unmark();
      unpoint();
    };
  }

  /** Draws on a change of geometry, view, sun or theme, a camera move or a resize; nothing before
   * the studio is prepared. Cars come once the house is on screen. */
  function stage(canvas: HTMLCanvasElement): () => void {
    const camera = lensOf(untrack(() => navigation));
    const scene = studioOn(canvas, camera);

    if (scene === null) return () => {};

    const { studio, flight, opening } = scene;
    const { render } = opening;
    const kept = keep(scene, source, render);
    const handling = { editing: () => editing, drawn: kept.drawn, panels: source.panels };
    // Before the picking and the orbit controls: a press on a handle or a trace never reaches them.
    const tracePress = new TracePress(canvas, camera, traceTool, () => tracing, kept.drawn);

    house = kept.drawn;
    const unhandle = handled.attach(canvas, camera, studio.scene, handling, render);
    const unlay = overlaid(studio.scene, () => roofTool.shown(roofwork), render);
    const roofSources = { roofwork: () => roofwork, drawn: kept.drawn, panels: source.panels };
    const roofPress = roofTool.attach(canvas, camera, roofSources);

    const unselect = selecting(canvas, camera, scene, kept.drawn);

    // A car that parks, leaves or changes body casts another shadow.
    const garage = { scene: studio.scene, recast: opening.recast, model: () => model };
    const parking = parkLater(canvas, opening, ghost, () => cars, garage);

    const controls = orbit(canvas, camera, flight, render, orbiting, () => navigation);
    const resize = fit(canvas, studio, camera, render, controls.target);

    opening
      .open(kept.built, () => onready?.(), parking.due)
      .catch(() => {
        onerror?.("failed");
      });

    return () => {
      resize.disconnect();
      tracePress.dispose();
      unhandle();
      roofPress.dispose();
      unlay();
      unselect();
      controls.dispose();
      parking.dispose();
      scene.dispose();
    };
  }
</script>

<div class="scene">
  <canvas
    aria-label={label}
    {@attach stage}
    style:cursor={tracing && traceTool.grabbing ? "grab" : undefined}
  ></canvas>
  <canvas
    bind:this={ghost.canvas}
    class={["ghost", ghost.phase, ghost.instant && "instant"]}
    ontransitionend={() => (ghost.phase = "off")}
    aria-hidden="true"
  ></canvas>
  <PerfOverlay />
  {#if tracing !== undefined && projected !== undefined}
    <TraceLayer {tracing} shown={traceTool.shown} project={projected} {seen} />
  {/if}
  {#if handled.label !== undefined}
    {@const { text, left, top } = handled.label}
    <!-- The same canvas chip as the live scene's labels; it never takes the pointer. -->
    <output
      class="canvas-chip pointer-events-none absolute flex h-7 translate-x-3.5 -translate-y-1/2 items-center rounded-md px-2 text-xs whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
      style:left="{left}px"
      style:top="{top}px"
    >
      {text}
    </output>
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
