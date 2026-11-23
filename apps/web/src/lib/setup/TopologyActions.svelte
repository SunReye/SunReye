<!-- The step's foot: accept first; "Anpassen" second, or back to the proposal while adjusting. -->
<script lang="ts">
  import type { Problem } from "../api/core.ts";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let {
    adjusting,
    refused,
    onaccept,
    onadjust,
    onreset,
  }: {
    adjusting: boolean;
    refused: Problem | undefined;
    onaccept: () => void;
    onadjust: () => void;
    onreset: () => void;
  } = $props();
</script>

<div class="flex flex-col gap-3 p-4">
  <Refusal {refused} />
  <div class="flex flex-col gap-2 sm:flex-row-reverse sm:self-end">
    <Button class="w-full sm:w-auto" onclick={onaccept}>{m.topology_accept()}</Button>
    {#if adjusting}
      <Button variant="ghost" class="w-full sm:w-auto" onclick={onreset}>
        {m.topology_reset()}
      </Button>
    {:else}
      <Button variant="outline" class="w-full sm:w-auto" onclick={onadjust}>
        {m.topology_adjust()}
      </Button>
    {/if}
  </div>
</div>
