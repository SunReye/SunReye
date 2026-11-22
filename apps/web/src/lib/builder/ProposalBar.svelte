<!-- Auto-stringing's result (ADR 20), listed above and drawn on the roof until it is kept or
  dropped. -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Proposal, WiringMode } from "./wiring-mode.svelte.ts";

  let { wiring, proposed }: { wiring: WiringMode; proposed: Pick<Proposal, "strings" | "left"> } =
    $props();
</script>

<div class="flex flex-col gap-2 p-3">
  <p role="status" class="text-sm font-medium">
    {m.builder_proposal({ count: proposed.strings })}
    {#if proposed.left > 0}
      {m.builder_proposal_left({ count: proposed.left })}
    {/if}
  </p>
  <div class="grid grid-cols-2 gap-2">
    <Button
      variant="outline"
      class="min-h-11"
      onclick={() => {
        wiring.discard();
      }}>{m.builder_discard()}</Button
    >
    <Button
      class="min-h-11"
      onclick={() => {
        wiring.keep();
      }}>{m.builder_keep()}</Button
    >
  </div>
</div>
