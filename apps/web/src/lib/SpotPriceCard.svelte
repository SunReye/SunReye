<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { getLocale } from "./paraglide/runtime.js";
  import SpotAttribution from "./SpotAttribution.svelte";

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
  <SpotAttribution class="source" />
</article>

<style>
  .price {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }

  article :global(.source) {
    font-size: 0.8rem;
  }
</style>
