<!--
  A form or picker (ADR 21): a Dialog wherever the shell shows its rail (a mouse, or touch from
  768 px), a bottom drawer under the phone's bar. The shell's rule, so every caller agrees.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import { motion } from "../motion/tier.svelte.ts";
  import { input } from "../shell/input.svelte.ts";
  import DrawerSheet from "./drawer-sheet.svelte";

  let {
    open = $bindable(false),
    label,
    children,
    class: className = "",
  }: { open?: boolean; label: string; children: Snippet; class?: string } = $props();

  let dialog: HTMLElement | null = $state(null);
</script>

{#if input.shell === "bar"}
  <DrawerSheet bind:open {label} class={className}>{@render children()}</DrawerSheet>
{:else}
  <Dialog.Root bind:open>
    <Dialog.Content
      bind:ref={dialog}
      tabindex={-1}
      showCloseButton={false}
      data-still={motion.still || undefined}
      onOpenAutoFocus={(e) => {
        // Focus the dialog, not its first control: a mouse open should not paint a focus ring.
        e.preventDefault();
        dialog?.focus();
      }}
      class="glass-ambient max-h-[85dvh] gap-0 overflow-y-auto p-0 py-3 no-scrollbar {className}"
    >
      <Dialog.Title class="sr-only">{label}</Dialog.Title>
      {@render children()}
    </Dialog.Content>
  </Dialog.Root>
{/if}
