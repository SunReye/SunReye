<script lang="ts" module>
  export type { Around, Editing, Roofwork, Projector } from "./drawing.svelte.ts";

  export type { Hit, Panel } from "./scene.ts";
</script>

<script lang="ts">
  import type { ModelLoader } from "../cars/garage.ts";
  import type { Parked } from "../cars/parked.ts";
  import { faceView, parseView, presetView, type View } from "./camera.ts";
  import type { Geometry, Point, RoofFace } from "./pv.ts";
  import SceneCanvas from "./SceneCanvas.svelte";
  import type { Around, Editing, Roofwork, Projector } from "./drawing.svelte.ts";
  import type { SceneWeather } from "../scene/weather.ts";
  import type { Hit, Panel } from "./scene.ts";
  import ViewMenu from "./ViewMenu.svelte";
  import WeatherMenu, { type Trial } from "./WeatherMenu.svelte";

  let {
    model,
    geometry,
    panels,
    around,
    sun,
    diffuse,
    weather,
    cars,
    onpick,
    editing,
    roofwork,
    onrender,
    onto,
    aspect = 1,
    trial = $bindable(null),
  }: {
    /** Reads an uploaded car body. */
    model?: ModelLoader | undefined;
    geometry: Geometry;
    panels: readonly Panel[];
    /** The aerial image and the neighbours the builder's consumer supplies. */
    around?: Around | undefined;
    /** Toward the sun at the slider's instant; null where it is unknown. */
    sun?: Point | null;
    /** How diffuse the sky's light is then, 0 to 1; null without weather for the instant. */
    diffuse?: number | null;
    /** Wet ground, lying snow and thunder then (ADR 23). */
    weather?: SceneWeather | undefined;
    /** The connected cars. */
    cars: readonly Parked[];
    onpick?: ((hit: Hit) => void) | undefined;
    /** After each draw: where a point of the scene lands on the canvas. */
    onrender?: ((project: Projector) => void) | undefined;
    /** The selected object's handles. */
    editing?: Editing | undefined;
    /** The selected face's laying, or the wiring mode's selecting. */
    roofwork?: Roofwork | undefined;
    /** The face the camera flies onto while it is given; it returns to the kept view after. */
    onto?: RoofFace | undefined;
    /** The canvas's width over its height: preset views fit the scene across it. */
    aspect?: number;
    /** The trial weather the weather button picks; null for the stored (ADR 23 "Builder"). */
    trial?: Trial | null;
  } = $props();

  /** Where each browser keeps its last view (ADR 20). */
  const KEPT = "sunreye.builder.view";

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  // As text: an edit lays the roofs out anew, and an equal view must not fly the camera back.
  const facing = $derived(onto === undefined ? "" : JSON.stringify(faceView(onto, aspect)));

  /** The view shown: a face's while one is given, until the admin's own orbit or preset. */
  let view = $derived(
    parseView(facing === "" ? null : facing) ?? kept ?? presetView("isometric", geometry, aspect),
  );

  function keep(next: View): void {
    kept = next;
    view = next;
    localStorage.setItem(KEPT, JSON.stringify(next));
  }
</script>

<SceneCanvas
  {geometry}
  {panels}
  {around}
  {sun}
  {diffuse}
  {weather}
  {cars}
  {model}
  {view}
  onview={keep}
  {onpick}
  {onrender}
  {editing}
  {roofwork}
/>
<div data-canvas-zone class="absolute top-3 right-3 flex flex-col gap-2">
  <ViewMenu
    onpick={(preset) => {
      keep(presetView(preset, geometry, aspect));
    }}
  />
  <WeatherMenu bind:trial />
</div>
