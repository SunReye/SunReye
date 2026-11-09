<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { getLocale } from "./paraglide/runtime.js";

  let {
    power,
    stale,
  }: {
    /** Each power series with its live value. */
    power: readonly (readonly [string, number])[];
    /** When each stale series was last read, in epoch milliseconds. */
    stale: Readonly<Record<string, number>>;
  } = $props();

  const watts = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
  const time = new Intl.DateTimeFormat(getLocale(), { timeStyle: "medium" });
</script>

<dl>
  {#each power as [series, value] (series)}
    <div>
      <dt>{series}</dt>
      <!-- An SI symbol, the same in every locale. -->
      <dd>{watts.format(value)} W</dd>
      {#if stale[series] !== undefined}
        <dd class="stale">{m.live_stale({ time: time.format(stale[series]) })}</dd>
      {/if}
    </div>
  {/each}
</dl>

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

  .stale {
    font-size: 0.875rem;
    color: #6b7280;
  }
</style>
