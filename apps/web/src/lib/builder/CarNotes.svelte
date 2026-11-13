<!-- The connected cars in the status strip: each loadpoint's charge power and its vehicle's SOC. -->
<script lang="ts">
  import Car from "@lucide/svelte/icons/car";
  import type { Device } from "../api/core.ts";
  import type { Parked } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";

  let {
    cars,
    devices,
  }: {
    cars: readonly Parked[];
    /** Names the cars' loadpoints. */
    devices: readonly Device[];
  } = $props();

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
</script>

{#if cars.length > 0}
  <ul aria-label={m.builder_cars()} class="flex shrink-0 items-center gap-3 tabular-nums">
    {#each cars as car, i (i)}
      <li class="flex items-center gap-1.5 text-foreground">
        <Car class="size-3.5 text-muted-foreground" />
        {carState(car)}
      </li>
    {/each}
  </ul>
{/if}
