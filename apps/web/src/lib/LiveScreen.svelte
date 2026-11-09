<script lang="ts">
  import type { Core, Live } from "./api/core";
  import DayChart from "./DayChart.svelte";
  import EvccCard from "./EvccCard.svelte";
  import LivePowers from "./LivePowers.svelte";
  import { problemText } from "./i18n/problems";
  import SpotPriceCard from "./SpotPriceCard.svelte";

  let { core }: { core: Core } = $props();

  let live = $state.raw<Live>();

  $effect(() =>
    core.live((next) => {
      live = next;
    }),
  );

  /**
   * Each device's values; an EVCC loadpoint is told by its `ev.charge.power`, the spot-price device
   * by its `price.spot`.
   */
  const devices = $derived.by(() => {
    if (live === undefined || !("devices" in live)) return [];

    const stale = live.stale ?? {};

    return Object.entries(live.devices).map(([id, values]) => ({
      id: Number(id),
      values,
      /** When each stale series was last read. */
      stale: stale[id] ?? {},
      loadpoint: "ev.charge.power" in values,
      spot: "price.spot" in values,
      power: Object.entries(values)
        .filter(([series]) => series.endsWith(".power"))
        .toSorted(([a], [b]) => a.localeCompare(b)),
    }));
  });
</script>

<main>
  {#if live !== undefined && "problem" in live}
    <p role="alert">{problemText(live.problem)}</p>
  {/if}
  {#each devices as device (device.id)}
    {#if device.loadpoint}
      <EvccCard values={device.values} />
    {:else if device.spot}
      <SpotPriceCard values={device.values} />
    {:else}
      <section>
        <LivePowers power={device.power} stale={device.stale} />
        <DayChart {core} device={device.id} series={device.power.map(([series]) => series)} />
      </section>
    {/if}
  {/each}
</main>
