<script lang="ts" module>
  export type { Editing, Painting, Projector } from "./SceneCanvas.svelte";

  export type { Hit, Panel } from "./scene.ts";
</script>

<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { modelLoader } from "../cars/models.ts";
  import type { Parked } from "../cars/parked.ts";
  import {
    faceView,
    parseView,
    presetView,
    type View,
  } from "./camera.ts";
  import type { SceneWeather } from "../scene/weather.ts";
  import type { Geometry, Point, RoofFace } from "./pv.ts";
  import SceneCanvas, {
    type Editing,
    type Painting,
    type Projector,
  } from "./SceneCanvas.svelte";
  import type { Hit, Panel } from "./scene.ts";
  import ViewMenu from "./ViewMenu.svelte";
  import WeatherMenu, { type Trial } from "./WeatherMenu.svelte";

  let {
    core,
    geometry,
    panels,
    sun,
    diffuse,
    weather,
    cars,
    onpick,
    editing,
    painting,
    onrender,
    onto,
    aspect = 1,
    trial = $bindable(null),
  }: {
    core: Core;
    geometry: Geometry;
    panels: readonly Panel[];
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
    /** The picked string, painted by a drag across modules. */
    painting?: Painting | undefined;
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

  const model = $derived(modelLoader(core));

  function keep(next: View): void {
    kept = next;
    view = next;
    localStorage.setItem(KEPT, JSON.stringify(next));
  }
</script>

<SceneCanvas
  {geometry}
  {panels}
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
  {painting}
/>
<div class="absolute top-3 right-3 flex flex-col gap-2">
  <ViewMenu
    onpick={(preset) => {
      keep(presetView(preset, geometry, aspect));
    }}
  />
  <WeatherMenu bind:trial />
</div>
