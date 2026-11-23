<!--
  The builder's canvas (ADR 20) and its zones: the time slider along the top with the views'
  button at its right, one status line at the lower left and the tools at the lower right. The
  rest is the camera's. No glass behind the scene itself (ADR 11).
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import { parkedNow } from "../cars/parked.svelte.ts";
  import type { Moment } from "./moment.svelte.ts";
  import type { Draft } from "@sunreye/builder/builder/modules.ts";
  import type { Geometry, Location, RoofFace } from "@sunreye/builder/builder/pv.ts";
  import ContextBar, { type Selected } from "@sunreye/builder/builder/ContextBar.svelte";
  import Stage, {
    type Around,
    type Editing,
    type Hit,
    type Roofwork,
    type Panel,
    type Projector,
  } from "./Stage.svelte";
  import StatusStrip from "./StatusStrip.svelte";
  import TimeSlider from "./TimeSlider.svelte";

  let {
    core,
    draft,
    geometry,
    panels,
    around,
    devices,
    location,
    moment,
    clear = 0,
    covered = false,
    onpick,
    editing,
    roofwork,
    onto,
    tools,
    selected,
  }: {
    core: Core;
    /** Read, never written: the slider changes nothing in the scene (ADR 20). */
    draft: Draft;
    geometry: Geometry;
    panels: readonly Panel[];
    /** The aerial image and the neighbours the builder's consumer supplies. */
    around?: Around | undefined;
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
    /** The selected face's laying, or the wiring mode's selecting. */
    roofwork?: Roofwork | undefined;
    /** The roof face a phone's camera flies onto: from afar a module is too small for a finger
     * (ADR 20). */
    onto?: RoofFace | undefined;
    /** Buttons at the lower right, beside the status line. */
    tools?: Snippet | undefined;
    /** The session whose selection carries the context toolbar. */
    selected?: Selected | undefined;
  } = $props();

  let width = $state(0);
  let height = $state(0);
  let canvas = $state<HTMLDivElement>();

  /** Where a point of the scene lands on the canvas, as last drawn. */
  let project = $state.raw<Projector>();

  /** A pointer is down on the canvas: it orbits or drags, and the toolbar is out of its way. */
  let held = $state(false);

  const cars = $derived(parkedNow(draft.scene.carPlaces ?? [], geometry.stands));
</script>

<!-- Edge to edge on a phone. -->
<div
  bind:this={canvas}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onpointerdowncapture={(event) => {
    held = event.target instanceof HTMLCanvasElement;
  }}
  onpointerupcapture={() => {
    held = false;
  }}
  onpointercancelcapture={() => {
    held = false;
  }}
  class="relative size-full min-h-0 overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1 max-sm:rounded-none max-sm:ring-0 max-sm:[box-shadow:none]"
>
  <!-- Measured first: the first view fits the canvas, with no flight to it. -->
  {#if height > 0}
    <Stage
      {core}
      {geometry}
      {panels}
      {around}
      sun={moment.sun}
      diffuse={moment.weather.cloud}
      weather={moment.scene}
      {cars}
      {onpick}
      {editing}
      {roofwork}
      onrender={(next) => {
        project = next;
      }}
      {onto}
      aspect={width / height}
      bind:trial={moment.trial}
    />
  {/if}

  {#if selected !== undefined && project !== undefined && canvas !== undefined && !held && !covered}
    <ContextBar session={selected} {project} {canvas} {clear} />
  {/if}

  <!-- Beside the views' button, which the stage keeps at the top right. -->
  <div class="pointer-events-none absolute top-3 right-16 left-3 flex">
    <div data-canvas-zone class="pointer-events-auto w-full max-w-md">
      <TimeSlider bind:day={moment.day} bind:minutes={moment.minutes} />
    </div>
  </div>

  <!-- One row: the status line takes what the tools leave, so the two never overlap. -->
  <div
    class={[
      "pointer-events-none absolute inset-x-3 bottom-3 flex items-end gap-2 transition-[opacity,visibility] duration-(--motion-fast) ease-(--motion-ease)",
      covered && "invisible opacity-0",
    ]}
    style:margin-bottom="{clear}px"
  >
    <div class="flex min-w-0 flex-1">
      <StatusStrip
        strings={draft.strings}
        watts={moment.watts}
        source={moment.production?.source}
        {cars}
        {devices}
        located={location !== undefined}
      />
    </div>
    {#if tools}
      <div data-canvas-zone class="pointer-events-auto shrink-0">
        {@render tools()}
      </div>
    {/if}
  </div>
</div>
