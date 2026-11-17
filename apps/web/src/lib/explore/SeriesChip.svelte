<!--
  One chosen series as a removable chip (ADR 22). A series the catalog no longer lists is struck
  through and said to be gone; it can still be removed.
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { Chosen } from "./picker.ts";

  let {
    series,
    gone,
    onremove,
  }: {
    series: Chosen;
    /** The catalog was read and does not list it. */
    gone: boolean;
    onremove: () => void;
  } = $props();

  const device = $derived(
    series.removed ? `${series.device} (${m.explore_removed()})` : series.device,
  );
</script>

<li
  class="flex h-8 max-w-full items-center rounded-md border border-border/60 bg-foreground/[0.04] pl-2.5 text-xs touch:h-11"
>
  <span class="min-w-0 truncate">
    <span class={["font-medium", gone && "text-muted-foreground line-through"]}
      >{series.estimated ? "≈ " : ""}{series.label}</span
    >
    <span class="text-muted-foreground"> · {gone ? m.explore_gone() : device}</span>
  </span>
  <Pressable
    feedback
    class="ml-1 grid h-full w-8 shrink-0 place-items-center rounded-r-md text-muted-foreground hover:text-foreground touch:w-11"
    aria-label={m.explore_remove({ name: series.label })}
    onclick={() => {
      haptics.light();
      onremove();
    }}
  >
    <X class="size-3.5" />
  </Pressable>
</li>
