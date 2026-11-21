<!--
  One chosen series as a removable chip (ADR 22). A series the catalog no longer lists is struck
  through and said to be gone; it can still be removed.
-->
<script lang="ts">
  import RemovableChip from "../components/removable-chip.svelte";
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

<RemovableChip remove={m.explore_remove({ name: series.label })} {onremove}>
  <span class="min-w-0 truncate">
    <span class={["font-medium", gone && "text-muted-foreground line-through"]}
      >{series.estimated ? "≈ " : ""}{series.label}</span
    >
    <span class="text-muted-foreground"> · {gone ? m.explore_gone() : device}</span>
  </span>
</RemovableChip>
