<script lang="ts">
  import type { Core, Live } from "./api/core";
  import DayChart from "./DayChart.svelte";

  let { core }: { core: Core } = $props();

  let live = $state.raw<Live>();

  $effect(() =>
    core.live((next) => {
      live = next;
    }),
  );

  const watts = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

  /** Each device's power series, sorted by name; other roles wait for their own screens. */
  const devices = $derived(
    live !== undefined && "devices" in live
      ? Object.entries(live.devices).map(([id, values]) => ({
          id: Number(id),
          power: Object.entries(values)
            .filter(([series]) => series.endsWith(".power"))
            .toSorted(([a], [b]) => a.localeCompare(b)),
        }))
      : [],
  );
</script>

<main>
  {#if live !== undefined && "problem" in live}
    <p role="alert">{live.problem}</p>
  {/if}
  {#each devices as device (device.id)}
    <section>
      <dl>
        {#each device.power as [series, value] (series)}
          <div>
            <dt>{series}</dt>
            <dd>{watts.format(value)} W</dd>
          </div>
        {/each}
      </dl>
      <DayChart {core} device={device.id} series={device.power.map(([series]) => series)} />
    </section>
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
