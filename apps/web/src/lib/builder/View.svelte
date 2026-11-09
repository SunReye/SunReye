<script lang="ts">
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import ModelCheck from "./ModelCheck.svelte";
  import { Moment } from "./moment.svelte.ts";
  import type { Draft } from "./modules.ts";
  import type { Geometry, Location, Pv } from "./pv.ts";
  import type { Panel } from "./scene.ts";
  import Stage from "./Stage.svelte";
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
  } = $props();

  const moment = new Moment(() => ({ core, pv, draft, moduleTypes, location }));

  const local = $derived(new Date(moment.at));
</script>

<div>
  <Stage
    {core}
    {geometry}
    {panels}
    sun={moment.sun}
    places={draft.scene.carPlaces ?? []}
    {devices}
  />
  <TimeSlider
    bind:day={moment.day}
    bind:minutes={moment.minutes}
    source={moment.production?.source}
    strings={draft.strings.map(({ name }, i) => ({ name, watts: moment.watts[i] ?? null }))}
    located={location !== undefined}
  />
  <ModelCheck {core} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
</div>

<style>
  div {
    display: grid;
    gap: 1rem;
    align-content: start;
  }
</style>
