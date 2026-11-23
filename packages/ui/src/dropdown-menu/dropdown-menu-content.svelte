<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "../utils.ts";
  import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    sideOffset = 4,
    align = "start",
    portalProps,
    class: className,
    // Local: the scroll fade (ADR 21, #753): the items scroll in an inner viewport.
    children,
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
  } = $props();
</script>

<DropdownMenuPortal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    data-slot="dropdown-menu-content"
    {sideOffset}
    {align}
    class={cn(
      // Local: duration and easing from the motion item, not upstream's duration-100 and CSS `ease` (ADR 0003, #38); the scale-in on the spring, fade and slide on the plain curve (#47).
      // Local: glass (translucent, blurred, grain; the theme item's tokens) instead of upstream's bg-popover (#39); elevation step 3 instead of shadow-md (#58).
      "data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 glass text-popover-foreground min-w-32 rounded-md elevation-3 ring-1 duration-(--motion-base) ease-(--motion-ease) z-50 max-h-(--bits-dropdown-menu-content-available-height) w-(--bits-dropdown-menu-anchor-width) origin-(--bits-dropdown-menu-content-transform-origin) flex flex-col overflow-hidden",
      className,
    )}
    {...restProps}
  >
    <!-- Local: the scroll fade (ADR 21, #753): the glass keeps its edge and the list fades inside it. -->
    <div
      data-slot="dropdown-menu-viewport"
      class="min-h-0 overflow-x-hidden overflow-y-auto p-1 scroll-fade-y no-scrollbar"
    >
      {@render children?.()}
    </div>
  </DropdownMenuPrimitive.Content>
</DropdownMenuPortal>
