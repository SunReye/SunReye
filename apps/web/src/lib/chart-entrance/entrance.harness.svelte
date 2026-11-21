<!-- Test harness: a chart of `count` bars and a pulsing live dot, behind a chart entrance. -->
<script lang="ts">
  import "../../app.css";
  import ChartEntrance, { type Build } from "./ChartEntrance.svelte";

  let {
    build,
    ready,
    count = 3,
    key,
  }: { build: Build; ready: boolean; count?: number; key?: unknown } = $props();
</script>

<ChartEntrance {build} {ready} {key} class="relative h-20 w-60">
  <div class="flex h-full items-end gap-1" data-plot>
    {#each { length: count } as _, i (i)}
      <span class="h-1/2 flex-1 origin-bottom bg-foreground" data-grow style:--i={i / count}></span>
    {/each}
    <span class="size-1.5 animate-pulse rounded-full bg-success" data-live></span>
  </div>
</ChartEntrance>
