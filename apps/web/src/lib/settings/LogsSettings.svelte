<!-- Settings › Logs: every write with its outcome (ADR 7). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import WriteLog from "./WriteLog.svelte";

  let { core }: { core: Core } = $props();

  const log = $derived(core.writes());
</script>

<div class="overflow-x-auto p-4">
  {#await log then answer}
    <WriteLog log={answer} />
  {/await}
</div>
