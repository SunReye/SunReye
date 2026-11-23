<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn } from "@sunreye/ui/utils";
  import type { WithoutChildrenOrChild } from "@sunreye/ui/utils";
  import ContextMenuPortal from "./context-menu-portal.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    portalProps,
    class: className,
    // Local: the scroll fade (ADR 21, #753): the items scroll in an inner viewport.
    children,
    ...restProps
  }: ContextMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof ContextMenuPortal>>;
  } = $props();
</script>

<ContextMenuPortal {...portalProps}>
  <ContextMenuPrimitive.Content
    bind:ref
    data-slot="context-menu-content"
    class={cn(
      // Local: the app's overlay glass, spring-in and elevation, timed by the motion tokens, instead of upstream's bg-popover, zoom, shadow and duration-100 (ADR 21, #750).
      "data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 glass text-popover-foreground min-w-36 rounded-md elevation-3 ring-1 duration-(--motion-base) ease-(--motion-ease) z-50 max-h-(--bits-context-menu-content-available-height) origin-(--bits-context-menu-content-transform-origin) flex flex-col overflow-hidden",
      className,
    )}
    {...restProps}
  >
    <!-- Local: the scroll fade (ADR 21, #753): the glass keeps its edge and the list fades inside it. -->
    <div
      data-slot="context-menu-viewport"
      class="min-h-0 overflow-x-hidden overflow-y-auto p-1 scroll-fade-y no-scrollbar"
    >
      {@render children?.()}
    </div>
  </ContextMenuPrimitive.Content>
</ContextMenuPortal>
