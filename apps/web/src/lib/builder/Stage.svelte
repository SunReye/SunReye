<script lang="ts" module>
  export type { Editing, Painting } from "./SceneCanvas.svelte";

  export type { Lie, Stood } from "./drawing.svelte.ts";

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
  import type { Geometry, Point, RoofFace } from "./pv.ts";
  import SceneCanvas, { type Editing, type Painting } from "./SceneCanvas.svelte";
  import type { Lie, Stood } from "./drawing.svelte.ts";
  import type { Hit, Panel } from "./scene.ts";
  import ViewMenu from "./ViewMenu.svelte";

  let {
    core,
    geometry,
    panels,
    sun,
    diffuse,
    cars,
    onpick,
    editing,
    painting,
    around,
    lie,
    ghosts = false,
    onto,
    aspect = 1,
  }: {
    core: Core;
    geometry: Geometry;
    panels: readonly Panel[];
    /** Toward the sun at the slider's instant; null where it is unknown. */
    sun?: Point | null;
    /** How diffuse the sky's light is then, 0 to 1; null without weather for the instant. */
    diffuse?: number | null;
    /** The connected cars. */
    cars: readonly Parked[];
    onpick?: ((hit: Hit) => void) | undefined;
    /** The selected object's handles. */
    editing?: Editing | undefined;
    /** The picked string, painted by a drag across modules. */
    painting?: Painting | undefined;
    /** The imported surroundings as the crate stood them, where they lie now, and whether their
     * hidden buildings are drawn see-through. */
    around?: Stood | undefined;
    lie?: Lie | null | undefined;
    ghosts?: boolean;
    /** The face the camera flies onto while it is given; it returns to the kept view after. */
    onto?: RoofFace | undefined;
    /** The canvas's width over its height: preset views fit the scene across it. */
    aspect?: number;
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
  {cars}
  {model}
  {view}
  onview={keep}
  {onpick}
  {editing}
  {painting}
  {around}
  {lie}
  {ghosts}
/>
<div class="absolute top-3 right-3">
  <ViewMenu
    onpick={(preset) => {
      keep(presetView(preset, geometry, aspect));
    }}
  />
</div>
