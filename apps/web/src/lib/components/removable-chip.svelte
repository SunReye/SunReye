<!--
  A chosen thing as a chip with its remove button (ADR 21 "One behaviour, one component"): a
  series, a period laid over the range. The remove is a press on the chip's one action: `light`.
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import type { Snippet } from "svelte";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";

  let {
    remove,
    onremove,
    children,
  }: {
    /** The remove button's name: "Süd entfernen". */
    remove: string;
    onremove: () => void;
    children: Snippet;
  } = $props();
</script>

<li
  class="flex h-8 max-w-full items-center rounded-md border border-border/60 bg-foreground/[0.04] pl-2.5 text-xs touch:h-11"
>
  {@render children()}
  <Pressable
    feedback
    class="ml-1 grid h-full w-8 shrink-0 place-items-center rounded-r-md text-muted-foreground hover:text-foreground touch:w-11"
    aria-label={remove}
    onclick={() => {
      haptics.light();
      onremove();
    }}
  >
    <X class="size-3.5" />
  </Pressable>
</li>
