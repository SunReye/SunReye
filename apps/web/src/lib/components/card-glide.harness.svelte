<!-- Test harness: a card over a block of content, in a frame of a set width, and what stands below. -->
<script lang="ts">
  import * as Card from "./ui/card/index.js";

  let {
    height,
    width = 320,
    interactive = false,
    words = 0,
    fill = false,
  }: {
    /** The content's height, in px. */
    height: number;
    width?: number;
    interactive?: boolean;
    /** Words that wrap at the frame's width, over the content. */
    words?: number;
    /** A part that fills what the card leaves over. */
    fill?: boolean;
  } = $props();
</script>

<div style:width="{width}px">
  <Card.Root {interactive} data-testid="card">
    {#if words > 0}
      <p>{Array.from({ length: words }, () => "Ertrag").join(" ")}</p>
    {/if}
    <div style:height="{height}px"></div>
    {#if fill}
      <div class="min-h-0 flex-1" data-fill></div>
    {/if}
  </Card.Root>
  <p data-testid="below">Darunter</p>
</div>
