<!-- The savings sheet before a tariff is set (ADR 12): nothing was saved, and the way to set one. -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let { admin }: { admin: boolean } = $props();
</script>

<div class="flex flex-col items-start gap-3 py-6">
  <p class="text-sm">{m.detail_no_tariff()}</p>
  {#if admin}
    <Button variant="outline" size="sm" href="#/settings?group=tariff">{m.detail_set_tariff()}</Button>
  {:else}
    <p class="text-sm text-muted-foreground">{m.detail_no_tariff_viewer()}</p>
  {/if}
</div>
