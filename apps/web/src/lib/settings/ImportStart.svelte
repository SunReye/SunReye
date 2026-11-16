<!-- The danger zone's start: an `error`-treated button that asks first, as nothing takes an import back. -->
<script lang="ts">
  import type { Problem } from "../api/core";
  import ConfirmSheet from "../components/confirm-sheet.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let {
    disabled,
    onstart,
  }: { disabled: boolean; onstart: () => Promise<Problem | undefined> } = $props();

  let asking = $state(false);
</script>

<div class="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 pt-4">
  <Button variant="destructive" size="sm" {disabled} onclick={() => (asking = true)}>
    {m.import_start()}
  </Button>
</div>
<!-- No toast: the panel shows the import's progress and outcome. -->
<ConfirmSheet
  bind:open={asking}
  title={m.import_confirm_title()}
  note={m.import_confirm_note()}
  action={m.import_confirm()}
  onconfirm={onstart}
/>
