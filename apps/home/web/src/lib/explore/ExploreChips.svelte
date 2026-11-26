<!-- The saved views as chips above the chosen series' (ADR 22). -->
<script lang="ts">
  import type { Explore } from "./explore.svelte.ts";
  import SeriesChips from "./SeriesChips.svelte";
  import ViewChips from "./ViewChips.svelte";

  let { x, onadd }: { x: Explore; onadd: () => void } = $props();
</script>

<ViewChips views={x.saved.list} marked={x.saved.marked} onopen={x.saved.open} />
<SeriesChips chosen={x.chosen} ready={x.catalog === "ready"} onremove={x.toggle} {onadd} />
