<!-- A level's remove action: nothing brings it back, so it asks first in a confirm (ADR 21). -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Problem } from "../api/core";
  import ConfirmSheet from "../components/confirm-sheet.svelte";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let {
    ask,
    name,
    note,
    onremove,
  }: {
    /** The remove button's label. */
    ask: string;
    /** What it removes, for the confirm's title. */
    name: string;
    /** What removing does. */
    note: string;
    onremove: () => Promise<Problem | undefined>;
  } = $props();

  let asking = $state(false);
</script>

<div class="flex flex-col gap-3 border-t border-border/60 p-4">
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
</div>
<ConfirmSheet
  bind:open={asking}
  title={m.settings_remove_named({ name })}
  {note}
  action={m.settings_remove()}
  done={m.settings_removed()}
  onconfirm={onremove}
/>
