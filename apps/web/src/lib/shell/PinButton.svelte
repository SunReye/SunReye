<!-- The rail's pin: an expanded rail stays open. -->
<script lang="ts">
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let { pinned, ontoggle }: { pinned: boolean; ontoggle: () => void } = $props();
</script>

<Button
  variant="ghost"
  size="icon-sm"
  onclick={ontoggle}
  class="label pointer-events-auto ml-auto"
  aria-label={pinned ? m.nav_unpin() : m.nav_pin()}
  aria-pressed={pinned}
>
  {#if pinned}<PinOff />{:else}<Pin />{/if}
</Button>
