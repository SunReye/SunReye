<script lang="ts">
  import * as ResizablePrimitive from "paneforge";
  import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    withHandle = false,
    ...restProps
  }: WithoutChildrenOrChild<ResizablePrimitive.PaneResizerProps> & {
    withHandle?: boolean;
  } = $props();
</script>

<ResizablePrimitive.PaneResizer
  bind:ref
  data-slot="resizable-handle"
  class={cn(
    // Local: a 44 px grab area on touch (ADR 21, #750).
    "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 touch:after:w-11 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-1 touch:data-[direction=vertical]:after:h-11 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:translate-x-0 data-[direction=vertical]:after:-translate-y-1/2 [&[data-direction=vertical]>div]:rotate-90",
    className,
  )}
  {...restProps}
>
  {#if withHandle}
    <!-- Local: a boxy grip (ADR 21, #750). -->
    <div class="bg-border h-6 w-1 rounded-sm z-10 flex shrink-0"></div>
  {/if}
</ResizablePrimitive.PaneResizer>
