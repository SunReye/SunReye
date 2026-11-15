<!--
  The bottom drawer (ADR 21): open or closed, no snap points. It follows the finger, settles back
  open or closes on a pull down, and plays `soft` when a drag lets go. Instant on the still tier.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Drawer from "#lib/components/ui/drawer/index.js";
  import { haptics } from "../haptics.ts";
  import { motion } from "../motion/tier.svelte.ts";

  let {
    open = $bindable(false),
    label,
    children,
    class: className = "",
  }: { open?: boolean; label: string; children: Snippet; class?: string } = $props();

  let sheet: HTMLElement | null = $state(null);
</script>

<Drawer.Root bind:open shouldScaleBackground={false} onRelease={() => haptics.soft()}>
  <Drawer.Content
    bind:ref={sheet}
    tabindex={-1}
    data-still={motion.still || undefined}
    onOpenAutoFocus={() => {
      // Focus the drawer, not its first control: opening should not paint a focus ring.
      sheet?.focus();
    }}
    class="glass-ambient mx-auto max-w-xl outline-none pb-[max(1rem,env(safe-area-inset-bottom))] {className}"
  >
    <Drawer.Title class="sr-only">{label}</Drawer.Title>
    {@render children()}
  </Drawer.Content>
</Drawer.Root>
