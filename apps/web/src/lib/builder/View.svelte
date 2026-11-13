<!--
  The builder's canvas (ADR 20): the scene at the slider's instant, the slider over its top edge,
  preset views on its right, and what the instant produces at its lower left. No glass behind the
  scene itself (ADR 11).
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import ModelCheck from "./ModelCheck.svelte";
  import { Moment } from "./moment.svelte.ts";
  import type { Draft } from "./modules.ts";
  import type { Geometry, Location, Pv } from "./pv.ts";
  import Stage, { type Editing, type Hit, type Painting, type Panel } from "./Stage.svelte";
  import StringPowers from "./StringPowers.svelte";
  import TimeSlider from "./TimeSlider.svelte";

  let {
    pv,
    core,
    draft,
    geometry,
    panels,
    moduleTypes,
    devices,
    location,
    clear = 0,
    onpick,
    editing,
    painting,
    tools,
  }: {
    pv: Pv;
    core: Core;
    /** Read, never written: the slider changes nothing in the scene (ADR 20). */
    draft: Draft;
    geometry: Geometry;
    panels: readonly Panel[];
    moduleTypes: readonly ModuleType[];
    devices: readonly Device[];
    location: Location | undefined;
    /** Pixels at the bottom a sheet keeps covered. */
    clear?: number;
    onpick?: ((hit: Hit) => void) | undefined;
    /** The selected object's handles. */
    editing?: Editing | undefined;
    /** The picked string, painted by a drag across modules. */
    painting?: Painting | undefined;
    /** Buttons at the lower right, beside the notices. */
    tools?: Snippet | undefined;
  } = $props();

  /** The tools' height, which the cars' list keeps clear of. */
  let toolsHeight = $state(0);

  let width = $state(0);
  let height = $state(0);

  const moment = new Moment(() => ({ core, pv, draft, moduleTypes, location }));

  const local = $derived(new Date(moment.at));
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
      places={draft.scene.carPlaces ?? []}
      {devices}
      {onpick}
      {editing}
      {painting}
      clear={clear + toolsHeight}
      aspect={width / height}
    />
  {/if}

  <div class="pointer-events-none absolute inset-x-3 top-3 flex">
    <div class="pointer-events-auto w-full max-w-xl">
      <TimeSlider
        bind:day={moment.day}
        bind:minutes={moment.minutes}
        source={moment.production?.source}
      />
    </div>
  </div>

  <!-- The notices stack upward; the tools keep their own column, so nothing overlaps. -->
  <div
    class="pointer-events-none absolute inset-x-3 bottom-3 flex items-end gap-2"
    style:margin-bottom="{clear}px"
  >
    <div class="flex max-w-[min(28rem,70%)] min-w-0 flex-col gap-1 text-xs text-muted-foreground">
    {#if location === undefined}
      <p class="glass-ambient rounded-md px-2.5 py-1.5">{m.builder_no_location()}</p>
    {/if}
    {#if draft.strings.length > 0}
      <StringPowers
        strings={draft.strings}
        watts={moment.watts}
        measured={moment.production?.source === "measured"}
      />
    {/if}
    <ModelCheck {core} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
    </div>
    {#if tools}
      <div class="pointer-events-auto ml-auto" bind:clientHeight={toolsHeight}>
        {@render tools()}
      </div>
    {/if}
  </div>
</div>
