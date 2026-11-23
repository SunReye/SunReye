<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import { cn, type WithoutChild } from "@sunreye/ui/utils";

  let {
    ref = $bindable(null),
    class: className,
    inset = undefined,
    children,
    ...restProps
  }: WithoutChild<MenubarPrimitive.SubTriggerProps> & {
    inset?: boolean;
  } = $props();
</script>

<MenubarPrimitive.SubTrigger
  bind:ref
  data-slot="menubar-sub-trigger"
  data-inset={inset}
  class={cn(
    // Local: the highlight fades and the pointer is the theme's (`cursor-default` would override it); 44 px rows on touch (ADR 21, #750).
    "focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground gap-2 rounded-sm px-2 py-1.5 text-sm data-inset:pl-8 [&_svg:not([class*='size-'])]:size-4 flex transition-colors touch:min-h-11 items-center outline-none select-none",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <ChevronRightIcon class="cn-rtl-flip ml-auto size-4" />
</MenubarPrimitive.SubTrigger>
