<!-- The savings sheet's facts row: the savings since installation against the investment, which
  only the admin reads (ADR 12). A failed read, a refusal as much as a lost core, says so in its
  place with a retry (ADR 21). -->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import LoadFailed from "../components/load-failed.svelte";
  import StatStrip from "../components/stat-strip.svelte";
  import { m } from "../paraglide/messages.js";
  import { paybackFacts } from "./savings.ts";

  let { core }: { core: Readonly<Pick<Core, "payback">> } = $props();

  let payback = $derived(core.payback());

  function retry(): void {
    payback = core.payback();
  }
</script>

{#await payback then read}
  {#if "problem" in read}
    <LoadFailed text={m.stats_payback_error()} refused={read} onretry={retry} />
  {:else}
    <StatStrip closes="sheet" stats={paybackFacts(read)} />
  {/if}
{:catch}
  <LoadFailed text={m.stats_payback_error()} onretry={retry} />
{/await}
