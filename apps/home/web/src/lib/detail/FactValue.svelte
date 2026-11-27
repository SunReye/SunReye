<!-- One fact's value: a text, or a quantity sized as the sheet's lead or as a stat. -->
<script lang="ts">
  import type { Fact } from "./figures.ts";
  import Quantity from "./Quantity.svelte";

  let { fact, big }: { fact: Fact; big: boolean } = $props();
</script>

{#if "text" in fact}
  <span class="text-sm font-semibold">{fact.text}</span>
{:else}
  <span
    class={big ? "text-4xl leading-none font-semibold tracking-tight" : "text-sm font-semibold"}
  >
    <Quantity
      value={fact.value}
      unit={fact.unit}
      digits={fact.digits}
      unitClass={[big ? "text-lg" : "", "font-medium text-muted-foreground"]}
    />
  </span>
{/if}
