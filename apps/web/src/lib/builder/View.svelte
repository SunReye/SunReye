<!--
  The builder's canvas (ADR 20) and its zones: the time slider along the top with the views'
  button at its right, one status line at the lower left and the tools at the lower right. The
  rest is the camera's. No glass behind the scene itself (ADR 11).
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Core, Device, ModuleType, Values } from "../api/core.ts";
  import { parked } from "../cars/parked.ts";
  import { laying, type Level } from "./levels.ts";
  import type { Moment } from "./moment.svelte.ts";
  import type { Draft } from "./modules.ts";
  import type { Geometry, Location, RoofFace } from "./pv.ts";
  import Stage, {
    type Editing,
    type Hit,
    type Painting,
    type Panel,
    type Stood,
  } from "./Stage.svelte";
  import LowerZones from "./LowerZones.svelte";
  import TimeSlider from "./TimeSlider.svelte";

  let {
    core,
    draft,
    geometry,
    panels,
    devices,
    location,
    moment,
    clear = 0,
    covered = false,
    onpick,
    editing,
    painting,
    around,
    ghosts = false,
    roofs = [],
    facing,
    tools,
  }: {
    core: Core;
    /** Read, never written: the slider changes nothing in the scene (ADR 20). */
    draft: Draft;
    geometry: Geometry;
    panels: readonly Panel[];
    devices: readonly Device[];
    location: Location | undefined;
    /** The slider's instant. */
    moment: Moment;
    /** Pixels at the bottom a peeking sheet keeps covered. */
    clear?: number;
    /** Whether a pulled-up sheet covers the lower zones: they go, instead of lying under it. */
    covered?: boolean;
    onpick?: ((hit: Hit) => void) | undefined;
    /** The selected object's handles. */
    editing?: Editing | undefined;
    /** The picked string, painted by a drag across modules. */
    painting?: Painting | undefined;
    /** The imported surroundings as the crate stood them. */
    around?: Stood | undefined;
    /** Whether the hidden imported buildings are drawn see-through. */
    ghosts?: boolean;
    roofs?: readonly RoofFace[];
    /** A phone's inspector level: from afar a roof cell is too small for a finger, so the camera
     * flies onto the face whose modules it lays (ADR 20). */
    facing?: Level | undefined;
    /** Buttons at the lower right, beside the status line. */
    tools?: Snippet | undefined;
  } = $props();

  let width = $state(0);
  let height = $state(0);

  let values = $state.raw<Values["devices"]>({});

  $effect(() =>
    core.live((live) => {
      if ("devices" in live) values = live.devices;
    }),
  );

  const cars = $derived(parked(draft.scene.carPlaces ?? [], geometry.stands, values));
</script>

<!-- Edge to edge on a phone. -->
<div
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative size-full min-h-0 overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1 max-sm:rounded-none max-sm:ring-0 max-sm:[box-shadow:none]"
>
  <!-- Measured first: the first view fits the canvas, with no flight to it. -->
  {#if height > 0}
    <Stage
      {core}
      {geometry}
      {panels}
      sun={moment.sun}
      diffuse={moment.diffuse}
      {cars}
      {onpick}
      {editing}
      {painting}
      {around}
      lie={draft.scene.imported}
      {ghosts}
      onto={facing && laying(roofs, facing)}
      aspect={width / height}
    />
  {/if}

  <!-- Beside the views' button, which the stage keeps at the top right. -->
  <div class="pointer-events-none absolute top-3 right-16 left-3 flex">
    <div class="pointer-events-auto w-full max-w-md">
      <TimeSlider bind:day={moment.day} bind:minutes={moment.minutes} />
    </div>
  </div>

  <LowerZones
    status={{
      strings: draft.strings,
      watts: moment.watts,
      source: moment.production?.source,
      cars,
      devices,
      located: location !== undefined,
    }}
    credits={around?.around.credits ?? []}
    {clear}
    {covered}
    {tools}
  />
</div>
