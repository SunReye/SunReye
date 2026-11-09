<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { getLocale } from "./paraglide/runtime.js";

  /** The spot-price device's live values: `price.spot` in EUR/kWh (ADR 4). */
  let { values }: { values: Readonly<Record<string, number>> } = $props();

  const cents = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const price = $derived(values["price.spot"]);
</script>

<article>
  <h2>{m.spot_title()}</h2>
  {#if price !== undefined}
    <!-- A currency subunit symbol, the same in every locale. -->
    <p class="price">{cents.format(price * 100)} ct/kWh</p>
  {/if}
  <!-- The licence's conditions: the source, the licence and the change made (CC BY 4.0). -->
  <p class="source">
    {m.spot_source()}
    <a href="https://www.smard.de">Bundesnetzagentur | SMARD.de</a>,
    <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>,
    {m.spot_via()}
    <a href="https://energy-charts.info">energy-charts.info</a>; {m.spot_converted()}
  </p>
</article>

<style>
  .price {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }

  .source {
    font-size: 0.8rem;
  }
</style>
