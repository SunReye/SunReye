<!-- A mode's pane before its chart is built: its place, at the chart's size. -->
<script lang="ts">
  import ChartSpline from "@lucide/svelte/icons/chart-spline";
  import { m } from "../paraglide/messages.js";

  let { height }: { height: number } = $props();
</script>

<div
  class="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 text-sm text-muted-foreground"
  style:height="{height}px"
>
  <ChartSpline class="size-5" />
  <p>{m.explore_pending()}</p>
</div>
