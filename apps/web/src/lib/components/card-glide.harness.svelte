<!-- Test harness: a card over a block of content, in a frame of a set width, and what stands below. -->
<script lang="ts">
  import * as Card from "./ui/card/index.js";

  let {
    height,
    width = 320,
    interactive = false,
    words = 0,
    label = "",
    loading = false,
    frame = "",
  }: {
    /** The content's height, in px. */
    height: number;
    width?: number;
    interactive?: boolean;
    /** Words that wrap at the frame's width, over the content. */
    words?: number;
    /** Text in the content, which keeps its height. */
    label?: string;
    /** A placeholder of 40 px stands in for the content. */
    loading?: boolean;
    /** The card's own classes: its frame, as a screen's mode sets it. */
    frame?: string;
  } = $props();
</script>

<div style:width="{width}px">
  <Card.Root {interactive} class={frame} data-testid="card">
    {#if words > 0}
      <p>{Array.from({ length: words }, () => "Ertrag").join(" ")}</p>
    {/if}
    {#if loading}
      <div class="h-10"></div>
    {:else}
      <div style:height="{height}px">{label}</div>
    {/if}
  </Card.Root>
  <p data-testid="below">Darunter</p>
</div>
