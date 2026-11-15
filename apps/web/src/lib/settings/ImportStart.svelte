<!-- The danger zone's start: an `error`-treated button that asks first, as nothing takes an import back. -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let { disabled, onstart }: { disabled: boolean; onstart: () => void } = $props();

  let asking = $state(false);
</script>

<div class="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 pt-4">
  {#if asking}
    <p class="basis-full text-sm">{m.import_confirm_note()}</p>
    <Button variant="ghost" size="sm" onclick={() => (asking = false)}>{m.import_cancel()}</Button>
    <Button
      variant="destructive"
      size="sm"
      onclick={() => {
        asking = false;
        onstart();
      }}>{m.import_confirm()}</Button
    >
  {:else}
    <Button variant="destructive" size="sm" {disabled} onclick={() => (asking = true)}>
      {m.import_start()}
    </Button>
  {/if}
</div>
