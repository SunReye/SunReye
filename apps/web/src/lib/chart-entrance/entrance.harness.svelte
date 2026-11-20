<!-- Test harness: a chart of `count` bars, or a plain plot, behind a chart entrance. -->
<script lang="ts">
  import "../../app.css";
  import ChartEntrance, { type Build } from "./ChartEntrance.svelte";

  let { build, ready, count = 3 }: { build: Build; ready: boolean; count?: number } = $props();
</script>

<ChartEntrance {build} {ready} class="relative h-20 w-60">
  <div class="flex h-full items-end gap-1" data-plot>
    {#each { length: count } as _, i (i)}
      <span class="h-1/2 flex-1 origin-bottom bg-foreground" data-grow style:--i={i / count}></span>
    {/each}
  </div>
</ChartEntrance>
