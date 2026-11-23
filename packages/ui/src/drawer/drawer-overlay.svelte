<script lang="ts">
  import { Drawer as DrawerPrimitive } from "vaul-svelte";
  import { cn } from "../utils.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DrawerPrimitive.OverlayProps = $props();
</script>

<DrawerPrimitive.Overlay
  bind:ref
  data-slot="drawer-overlay"
  class={cn(
    // Local: the scrim's tint and grain, never a blur (ADR 21: it dims), instead of upstream's bg-black/10 and backdrop-blur-xs.
    "bg-(--glass-scrim) bg-(image:--noise-scrim) fixed inset-0 z-50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
    className,
  )}
  {...restProps}
/>
