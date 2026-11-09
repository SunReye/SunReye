<script lang="ts">
  import type { Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import CarPlaceFieldset from "./CarPlaceFieldset.svelte";
  import type { CarPlace } from "./pv.ts";

  let {
    places,
    devices,
    onchange,
  }: {
    places: readonly CarPlace[];
    /** Its EVCC loadpoints are what a place may name; none, and no place is added. */
    devices: readonly Device[];
    onchange: (places: readonly CarPlace[]) => void;
  } = $props();

  /** EVCC loadpoints, which a car place names (ADR 10). */
  const loadpoints = $derived(devices.filter(({ profile }) => profile === "evcc"));
</script>

<h2>{m.builder_car_places()}</h2>
{#each places as place, index}
  <CarPlaceFieldset
    {place}
    number={index + 1}
    {loadpoints}
    onchange={(next) => {
      onchange(places.with(index, next));
    }}
    onremove={() => {
      onchange(places.toSpliced(index, 1));
    }}
  />
{/each}
{#if loadpoints[0] !== undefined}
  {@const device = loadpoints[0].id}
  <button
    type="button"
    onclick={() => {
      onchange([...places, { device, x: 0, z: 10, width: 2.5, length: 5, rotation: 0 }]);
    }}>{m.builder_add_car_place()}</button
  >
{/if}
