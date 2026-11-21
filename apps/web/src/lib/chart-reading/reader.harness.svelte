<!-- Test harness: a plot 400 px wide that `read` reads. -->
<script lang="ts">
  import type { ChartReader } from "./reader.svelte.ts";

  let { read }: { read: ChartReader<number> } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  style="position: fixed; top: 0; left: 0; width: 400px; height: 100px"
  role="group"
  tabindex="0"
  data-plot
  {...read.on}
></div>
