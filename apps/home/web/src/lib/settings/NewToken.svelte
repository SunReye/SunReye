<!-- A token just created: the core shows it this once and keeps only its hash (ADR 9). -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import type { CreatedToken } from "../api/core";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let { created, ondone }: { created: CreatedToken; ondone: () => void } = $props();

  let copied = $state(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(created.token);
    copied = true;
  }
</script>

<div
  role="status"
  class="m-4 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
>
  <p>
    <span class="font-medium">{m.access_created({ name: created.name })}</span>
    <span class="text-muted-foreground">{m.access_once()}</span>
  </p>
  <code class="rounded-md bg-background/60 px-2.5 py-2 font-mono text-[13px] break-all select-all">
    {created.token}
  </code>
  <div class="flex gap-2">
    <Button variant="outline" size="sm" onclick={copy}>
      {#if copied}<Check data-icon="inline-start" />{:else}<Copy data-icon="inline-start" />{/if}
      {copied ? m.access_copied() : m.access_copy()}
    </Button>
    <Button size="sm" onclick={ondone}>{m.access_done()}</Button>
  </div>
</div>
