<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "@sunreye/ui/utils";
  import type { WithoutChildrenOrChild } from "@sunreye/ui/utils";
  import SelectPortal from "./select-portal.svelte";
  import SelectScrollDownButton from "./select-scroll-down-button.svelte";
  import SelectScrollUpButton from "./select-scroll-up-button.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    portalProps,
    children,
    preventScroll = true,
    ...restProps
  }: WithoutChild<SelectPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SelectPortal>>;
  } = $props();
</script>

<SelectPortal {...portalProps}>
  <SelectPrimitive.Content
    bind:ref
    {sideOffset}
    {preventScroll}
    data-slot="select-content"
    class={cn(
      // Local: duration and easing from the motion item, not upstream's duration-100 and CSS `ease` (ADR 0003, #38); the scale-in on the spring, fade and slide on the plain curve (#47).
      // Local: glass (translucent, blurred, grain; the theme item's tokens) instead of upstream's bg-popover (#39); elevation step 3 instead of shadow-md (#58).
      "glass text-popover-foreground data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-36 rounded-md elevation-3 ring-1 duration-(--motion-base) ease-(--motion-ease) relative z-50 max-h-(--bits-select-content-available-height) origin-(--bits-select-content-transform-origin) flex flex-col overflow-hidden",
      className,
    )}
    {...restProps}
  >
    <SelectScrollUpButton />
    <SelectPrimitive.Viewport
      class={cn(
        // Local: the scroll fade (ADR 21, #753): the list scrolls and fades inside the glass.
        "h-(--bits-select-anchor-height) w-full min-w-(--bits-select-anchor-width) scroll-my-1 min-h-0 overflow-y-auto scroll-fade-y no-scrollbar",
      )}
    >
      {@render children?.()}
    </SelectPrimitive.Viewport>
    <SelectScrollDownButton />
  </SelectPrimitive.Content>
</SelectPortal>
