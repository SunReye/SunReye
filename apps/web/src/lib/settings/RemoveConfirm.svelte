<!-- A level's remove action: it asks first with what removing keeps, as nothing brings it back. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Problem } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";

  let {
    ask,
    note,
    onremove,
  }: {
    /** The remove button's label. */
    ask: string;
    /** What removing does, shown while it waits for the confirm. */
    note: string;
    onremove: () => Promise<Problem | undefined>;
  } = $props();

  let asking = $state(false);

  let refused = $state.raw<Problem>();

  async function remove(): Promise<void> {
    refused = await onremove();
    asking = false;
  }
</script>

<div class="flex flex-col gap-3 border-t border-border/60 p-4">
  {#if asking}
    <p class="text-sm">{note}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        onclick={() => {
          asking = false;
        }}>{m.access_cancel()}</Button
      >
      <Button variant="destructive" onclick={remove}>{m.settings_remove()}</Button>
    </div>
  {:else}
    <Button
      variant="outline"
      class="text-destructive"
      onclick={() => {
        asking = true;
      }}
    >
      <Trash2 data-icon="inline-start" />
      {ask}
    </Button>
  {/if}
  <Refusal {refused} />
</div>
