<!--
  A card over the range (ADR 21): a finger anywhere on it but a chart drags its pane to the earlier
  or later range. What stands still (titles, the stepper) sits beside the pane.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "@sunreye/ui/card";
  import { cn } from "@sunreye/ui/utils";
  import { markCard } from "./card-surface.ts";

  let {
    class: className,
    top,
    children,
  }: {
    class?: string;
    /** Full width above the card's padded body, such as History's figures. */
    top?: Snippet | undefined;
    children?: Snippet | undefined;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  markCard({
    get el() {
      return el;
    },
  });
</script>

<Card.Root class={cn("@container gap-0 py-0", className)} bind:ref={el}>
  {@render top?.()}
  {#if children}
    <div class="flex flex-col gap-4 px-3 pt-4 pb-4 sm:px-5">
      {@render children()}
    </div>
  {/if}
</Card.Root>
