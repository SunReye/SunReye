<script lang="ts">
  import { PLANT } from "../live/labels.ts";
  import { m } from "../paraglide/messages.js";
  import type { Choice } from "./history.ts";

  let {
    devices,
    device = $bindable(),
    series = $bindable(),
  }: {
    devices: readonly Choice[];
    device: number | undefined;
    series: string | undefined;
  } = $props();

  const offered = $derived(devices.find((d) => d.device === device)?.series ?? []);

  function name(id: number): string {
    return String(id) === PLANT ? m.history_plant() : m.history_device({ device: id });
  }
</script>

{#if devices.length === 0}
  <p>{m.history_none()}</p>
{:else}
  <label>
    {m.history_device_label()}
    <select bind:value={device}>
      {#each devices as choice (choice.device)}
        <option value={choice.device}>{name(choice.device)}</option>
      {/each}
    </select>
  </label>
  <label>
    {m.history_series()}
    <select bind:value={series}>
      {#each offered as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </label>
{/if}
