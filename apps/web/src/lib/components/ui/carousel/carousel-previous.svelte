<script lang="ts">
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import { Button, type Props } from "@sunreye/ui/button";
  import { cn } from "@sunreye/ui/utils";
  import { getEmblaContext } from "./context.js";
  import type { WithoutChildren } from "bits-ui";

  let {
    ref = $bindable(null),
    class: className,
    variant = "outline",
    size = "icon-sm",
    ...restProps
  }: WithoutChildren<Props> = $props();

  const emblaCtx = getEmblaContext("<Carousel.Previous/>");
</script>

<Button
  data-slot="carousel-previous"
  {variant}
  {size}
  aria-disabled={!emblaCtx.canScrollPrev}
  disabled={!emblaCtx.canScrollPrev}
  class={cn(
    // Local: boxy: the button's own --radius corners, not upstream's circle; a 44 px hit area on touch (ADR 21, #750).
    "absolute touch-manipulation touch-hit",
    emblaCtx.orientation === "horizontal"
      ? "inset-y-0 -start-12 my-auto"
      : "start-1/2 -top-12 -translate-x-1/2 rotate-90",
    className,
  )}
  onclick={emblaCtx.scrollPrev}
  onkeydown={emblaCtx.handleKeyDown}
  {...restProps}
  bind:ref
>
  <ChevronLeftIcon class="cn-rtl-flip" />
  <span class="sr-only">Previous slide</span>
</Button>
