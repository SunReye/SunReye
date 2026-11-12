<!-- The open tab's content; every tab reads the screen's range but payback. -->
<script lang="ts">
  import ChartPane from "./ChartPane.svelte";
  import DetailPane from "./DetailPane.svelte";
  import { chartsRange, type PaneProps } from "./pane.ts";

  let props: PaneProps = $props();
</script>

{#if chartsRange(props.view.tab)}
  <ChartPane {...props} />
{:else}
  <DetailPane {...props} />
{/if}
