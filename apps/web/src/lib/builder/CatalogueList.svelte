<!--
  The module catalogue's body: each maker's series matching the query.
-->
<script lang="ts">
  import type { Datasheet, Sheet } from "@sunreye/catalogue";
  import { m } from "../paraglide/messages.js";
  import { shelves } from "./catalogue.ts";
  import CatalogueSeries from "./CatalogueSeries.svelte";

  let {
    sheets,
    query,
    adding,
    onpick,
  }: {
    sheets: readonly Sheet[];
    query: string;
    /** While a pick is being added; the rows wait. */
    adding: boolean;
    onpick: (datasheet: Readonly<Datasheet>) => void;
  } = $props();

  const makers = $derived(shelves(sheets, query));
</script>

{#if makers.length === 0}
  <p class="px-4 py-6 text-center text-sm text-muted-foreground">
    {m.builder_module_none({ query: query.trim() })}
  </p>
{/if}
{#each makers as maker (maker.name)}
  {#each maker.series as series (series.name)}
    <CatalogueSeries maker={maker.name} {series} {adding} {onpick} />
  {/each}
{/each}
