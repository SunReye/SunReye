<script lang="ts">
  import type { Core, Live } from "./api/core";
  import DayChart from "./DayChart.svelte";
  import EvccCard from "./EvccCard.svelte";
  import { problemText } from "./i18n/problems";
  import SpotPriceCard from "./SpotPriceCard.svelte";
  import { getLocale } from "./paraglide/runtime.js";

  let { core }: { core: Core } = $props();

  let live = $state.raw<Live>();

  $effect(() =>
    core.live((next) => {
      live = next;
    }),
  );

  const watts = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  /**
   * Each device's values; an EVCC loadpoint is told by its `ev.charge.power`, the spot-price device
   * by its `price.spot`.
   */
  const devices = $derived(
    live !== undefined && "devices" in live
      ? Object.entries(live.devices).map(([id, values]) => ({
          id: Number(id),
          values,
          loadpoint: "ev.charge.power" in values,
          spot: "price.spot" in values,
          power: Object.entries(values)
            .filter(([series]) => series.endsWith(".power"))
            .toSorted(([a], [b]) => a.localeCompare(b)),
        }))
      : [],
  );
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
        <dl>
          {#each device.power as [series, value] (series)}
            <div>
              <dt>{series}</dt>
              <!-- An SI symbol, the same in every locale. -->
              <dd>{watts.format(value)} W</dd>
            </div>
          {/each}
        </dl>
        <DayChart {core} device={device.id} series={device.power.map(([series]) => series)} />
      </section>
    {/if}
  {/each}
</main>

<style>
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  dd {
    margin: 0;
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }
</style>
