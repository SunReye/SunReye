<!--
  The module catalogue's body: each maker's series matching the query, or skeleton rows while the
  core answers.
-->
<script lang="ts">
  import type { CatalogueSheet, Datasheet } from "../api/core.ts";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import { shelves } from "./catalogue.ts";
  import CatalogueSeries from "./CatalogueSeries.svelte";

  let {
    sheets,
    query,
    adding,
    onpick,
  }: {
    /** Undefined while the core answers. */
    sheets: readonly CatalogueSheet[] | undefined;
    query: string;
    /** While a pick is being added; the rows wait. */
    adding: boolean;
    onpick: (datasheet: Readonly<Datasheet>) => void;
  } = $props();

  const makers = $derived(sheets === undefined ? [] : shelves(sheets, query));
</script>

{#if sheets === undefined}
  <LoadingRows rows={4} />
{:else if makers.length === 0}
  <p class="px-4 py-6 text-center text-sm text-muted-foreground">
    {m.builder_module_none({ query: query.trim() })}
  </p>
{/if}
{#each makers as maker (maker.name)}
  {#each maker.series as series (series.name)}
    <CatalogueSeries maker={maker.name} {series} {adding} {onpick} />
  {/each}
{/each}
