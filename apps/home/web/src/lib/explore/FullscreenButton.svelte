<!-- Into fullscreen and out of it (ADR 22), named by what a press does. -->
<script lang="ts">
  import Maximize from "@lucide/svelte/icons/maximize";
  import Minimize from "@lucide/svelte/icons/minimize";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let { full, onchange }: { full: boolean; onchange: () => void } = $props();

  const label = $derived(full ? m.explore_fullscreen_leave() : m.explore_fullscreen());
</script>

<Button variant="outline" size="icon-sm" aria-label={label} title={label} onclick={onchange}>
  {#if full}<Minimize />{:else}<Maximize />{/if}
</Button>
