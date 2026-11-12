<!--
  The builder's canvas (ADR 20): the scene at the slider's instant, the slider over its top edge,
  preset views on its right, and what the instant produces at its lower left. No glass behind the
  scene itself (ADR 11).
-->
<script lang="ts">
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import ModelCheck from "./ModelCheck.svelte";
  import { Moment } from "./moment.svelte.ts";
  import type { Draft } from "./modules.ts";
  import type { Geometry, Location, Pv } from "./pv.ts";
  import type { Hit, Panel } from "./scene.ts";
  import Stage, { type Editing, type Painting } from "./Stage.svelte";
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
  } = $props();

  const moment = new Moment(() => ({ core, pv, draft, moduleTypes, location }));

  const local = $derived(new Date(moment.at));

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  // Only measured history is a reading; the forecast and a clear sky are estimates (ADR 20).
  const prefix = $derived(moment.production?.source === "measured" ? "" : "≈");
</script>

<div
  class="relative size-full min-h-0 overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1"
>
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
  />

  <div class="pointer-events-none absolute inset-x-3 top-3 flex">
    <div class="pointer-events-auto w-full max-w-xl">
      <TimeSlider
        bind:day={moment.day}
        bind:minutes={moment.minutes}
        source={moment.production?.source}
      />
    </div>
  </div>

  <div
    class="pointer-events-none absolute bottom-3 left-3 flex max-w-[min(28rem,70%)] flex-col gap-1 text-xs text-muted-foreground"
    style:margin-bottom="{clear}px"
  >
    {#if location === undefined}
      <p class="glass-ambient rounded-md px-2.5 py-1.5">{m.builder_no_location()}</p>
    {/if}
    {#if draft.strings.length > 0}
      <ul
        aria-label={m.builder_strings_power()}
        class="glass-ambient flex flex-wrap gap-x-3 gap-y-0.5 rounded-md px-2.5 py-1.5 tabular-nums"
      >
        {#each draft.strings as { name }, i (i)}
          {@const watts = moment.watts[i] ?? null}
          <li class="text-foreground">
            {watts === null
              ? m.builder_string_dark({ name })
              : m.builder_string_power({ name, power: `${prefix}${format.format(watts)} W` })}
          </li>
        {/each}
      </ul>
    {/if}
    <ModelCheck {core} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
  </div>
</div>
