<script lang="ts">
  import type { Core, Device, Values } from "../api/core.ts";
  import { modelLoader } from "../cars/models.ts";
  import { parked, type Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { parseView, presetView, presets, type Preset, type View } from "./camera.ts";
  import type { CarPlace, Geometry, Point } from "./pv.ts";
  import SceneCanvas from "./SceneCanvas.svelte";
  import type { Panel } from "./scene.ts";

  let {
    core,
    geometry,
    panels,
    sun,
    places,
    devices,
  }: {
    core: Core;
    geometry: Geometry;
    panels: readonly Panel[];
    /** Toward the sun at the slider's instant; null where it is unknown. */
    sun?: Point | null;
    places: readonly CarPlace[];
    /** Names the cars' loadpoints. */
    devices: readonly Device[];
  } = $props();

  /** Where each browser keeps its last view (ADR 20). */
  const KEPT = "sunreye.builder.view";

  const labels: Readonly<Record<Preset, () => string>> = {
    north: m.view_north,
    east: m.view_east,
    south: m.view_south,
    west: m.view_west,
    top: m.view_top,
    isometric: m.view_isometric,
  };

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  let values = $state.raw<Values["devices"]>({});

  $effect(() =>
    core.live((live) => {
      if ("devices" in live) values = live.devices;
    }),
  );

  const model = $derived(modelLoader(core));

  const cars = $derived(parked(places, geometry.stands, values));

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  /** A connected car's charge power and its vehicle's SOC, as the live screen words them. */
  function carState({ device, watts, soc }: Parked): string {
    const name = devices.find(({ id }) => id === device)?.name ?? String(device);

    const charging =
      watts === null || watts === 0
        ? m.live_car_connected()
        : m.live_car_charging({ power: `${format.format(watts)} W` });

    const state =
      soc === null ? charging : `${charging} · ${m.live_soc({ soc: format.format(soc) })}`;

    return m.builder_car({ name, state });
  }

  function keep(view: View): void {
    kept = view;
    localStorage.setItem(KEPT, JSON.stringify(view));
  }
</script>

<section>
  <SceneCanvas
    {geometry}
    {panels}
    {sun}
    {cars}
    {model}
    view={kept ?? presetView("isometric", geometry)}
    onview={keep}
  />
  {#if cars.length > 0}
    <ul aria-label={m.builder_cars()}>
      {#each cars as car, i (i)}
        <li>{carState(car)}</li>
      {/each}
    </ul>
  {/if}
  <nav aria-label={m.builder_views()}>
    {#each presets as preset (preset)}
      <button
        type="button"
        onclick={() => {
          keep(presetView(preset, geometry));
        }}>{labels[preset]()}</button
      >
    {/each}
  </nav>
</section>

<style>
  section {
    display: grid;
    grid-template-rows: minmax(20rem, 70vh) auto;
    gap: 0.5rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }
</style>
