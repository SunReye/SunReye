<!-- The savings sheet's facts row: the savings since installation against the investment, which
  only the admin reads (ADR 12). A refused or failed read leaves the row out, as History does. -->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import DetailStats from "./DetailStats.svelte";
  import { paybackFacts } from "./savings.ts";

  let { core }: { core: Readonly<Pick<Core, "payback">> } = $props();

  const payback = $derived(core.payback());
</script>

{#await payback then read}
  {#if !("problem" in read)}
    <DetailStats stats={paybackFacts(read)} />
  {/if}
{:catch}
  <!-- A lost core leaves the row out too. -->
{/await}
