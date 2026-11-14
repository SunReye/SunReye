<!--
  A drill-in level's header: back, the centred title, and a column that mirrors back so the title
  sits at the same x on every level. Back and title cut with an ellipsis rather than overlap; on a
  phone's width back is its chevron alone, its label left to assistive tech.
-->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import { Button } from "../ui/button/index.js";

  let {
    back,
    title,
    onback,
    heading = "h2",
  }: {
    /** The level above's title. */
    back: string;
    title: string;
    onback: () => void;
    heading?: "h2" | "h3";
  } = $props();
</script>

<div
  data-drill="header"
  class="@container grid min-h-12 grid-cols-[minmax(2.25rem,1fr)_minmax(0,auto)_minmax(2.25rem,1fr)] items-center gap-1 border-b border-border/60 p-1.5"
>
  <Button
    variant="ghost"
    size="sm"
    onclick={onback}
    class="max-w-full min-w-0 justify-self-start text-brand"
  >
    <ChevronLeft data-icon="inline-start" />
    <span class="truncate @max-[26rem]:sr-only">{back}</span>
  </Button>
  <svelte:element this={heading} class="truncate px-1 text-center text-[15px] font-semibold">
    {title}
  </svelte:element>
</div>
