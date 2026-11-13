<!-- Settings › Logs: every write with its outcome (ADR 7). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  const log = $derived(core.writes());
</script>

{#await log}
  <LoadingRows rows={3} />
{:then answer}
  <div class="overflow-x-auto p-4">
    <WriteLog log={answer} />
  </div>
{/await}
