<!-- Test harness: a card over a block of content, in a frame of a set width, and what stands below. -->
<script lang="ts">
  import * as Card from "@sunreye/ui/card";

  let {
    height,
    width = 320,
    interactive = false,
    words = 0,
    label = "",
    loading = false,
    frame = "",
    travels = false,
    builds = false,
    column = 0,
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
    /** The content arrives on a way of its own, as a pane that slides in: seen all the way. */
    travels?: boolean;
    /** The content builds up as it first shows, as a chart's entrance. */
    builds?: boolean;
    /** A column of this height in px the card fills (`flex-1`), as the dashboard's side column. */
    column?: number;
  } = $props();
</script>

<div
  style:width="{width}px"
  style:height={column > 0 ? `${column}px` : undefined}
  class={{ "flex flex-col": column > 0 }}
>
  <Card.Root {interactive} class={[frame, column > 0 && "flex-1"]} data-testid="card">
    {#if words > 0}
      <p>{Array.from({ length: words }, () => "Ertrag").join(" ")}</p>
    {/if}
    {#if loading}
      <div class="h-10" data-testid="placeholder"></div>
    {:else}
      <div
        style:height="{height}px"
        class={{ builds }}
        data-testid="content"
        data-glide-shown={travels ? "" : undefined}
      >
        {label}
      </div>
    {/if}
  </Card.Root>
  <p data-testid="below">Darunter</p>
</div>

<style>
  .builds {
    animation: build 10s both;
  }
  @keyframes build {
    from {
      scale: 0;
    }
  }
</style>
