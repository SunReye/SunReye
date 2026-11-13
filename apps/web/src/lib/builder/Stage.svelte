<script lang="ts" module>
  export type { Editing, Painting } from "./SceneCanvas.svelte";

  export type { Hit, Panel } from "./scene.ts";
</script>

<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Core, Device, Values } from "../api/core.ts";
  import { modelLoader } from "../cars/models.ts";
  import { parked, type Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { parseView, presetView, presets, type Preset, type View } from "./camera.ts";
  import type { CarPlace, Geometry, Point } from "./pv.ts";
  import SceneCanvas, { type Editing, type Painting } from "./SceneCanvas.svelte";
  import type { Hit, Panel } from "./scene.ts";

  let {
    core,
    geometry,
    panels,
    sun,
    places,
    devices,
    onpick,
    editing,
    painting,
    clear = 0,
    aspect = 1,
  }: {
    core: Core;
    geometry: Geometry;
    panels: readonly Panel[];
    /** Toward the sun at the slider's instant; null where it is unknown. */
    sun?: Point | null;
    places: readonly CarPlace[];
    /** Names the cars' loadpoints. */
    devices: readonly Device[];
    onpick?: ((hit: Hit) => void) | undefined;
    /** The selected object's handles. */
    editing?: Editing | undefined;
    /** The picked string, painted by a drag across modules. */
    painting?: Painting | undefined;
    /** Pixels at the bottom a sheet or the tools keep covered. */
    clear?: number;
    /** The canvas's width over its height: preset views fit the scene across it. */
    aspect?: number;
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

<SceneCanvas
  {geometry}
  {panels}
  {sun}
  {cars}
  {model}
  view={kept ?? presetView("isometric", geometry, aspect)}
  onview={keep}
  {onpick}
  {editing}
  {painting}
/>
<nav
  aria-label={m.builder_views()}
  class="glass-ambient absolute top-1/2 right-3 flex -translate-y-1/2 flex-col gap-0.5 rounded-md p-0.5 ring-1 ring-border/60 elevation-1"
>
  {#each presets as preset (preset)}
    <Button
      variant="ghost"
      size="xs"
      class="justify-start"
      onclick={() => {
        keep(presetView(preset, geometry, aspect));
      }}>{labels[preset]()}</Button
    >
  {/each}
</nav>
{#if cars.length > 0}
  <ul
    aria-label={m.builder_cars()}
    class="glass-ambient absolute right-3 bottom-3 flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-xs"
    style:margin-bottom="{clear}px"
  >
    {#each cars as car, i (i)}
      <li>{carState(car)}</li>
    {/each}
  </ul>
{/if}
