<!-- Removes the inspector's object; undo brings it back (ADR 20), so nothing asks first. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let { onremove }: { onremove: () => void } = $props();
</script>

<div class="border-t border-border/60 p-3">
  <Button variant="destructive" class="w-full" onclick={onremove}>
    <Trash2 data-icon="inline-start" />
    {m.builder_remove()}
  </Button>
</div>
