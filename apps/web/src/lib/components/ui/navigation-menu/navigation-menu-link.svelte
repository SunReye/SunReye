<script lang="ts">
  import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
  import { cn } from "#lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: NavigationMenuPrimitive.LinkProps = $props();
</script>

<NavigationMenuPrimitive.Link
  bind:ref
  data-slot="navigation-menu-link"
  // Local: only colours and the ring fade, not upstream's transition-all; 44 px on touch (ADR 21, #750).
  class={cn(
    "data-[active=true]:focus:bg-muted data-[active=true]:hover:bg-muted data-[active=true]:bg-muted/50 focus-visible:ring-ring/50 hover:bg-muted focus:bg-muted flex items-center gap-1.5 rounded-md p-2 text-sm transition-[color,background-color,box-shadow] touch:min-h-11 outline-none focus-visible:ring-3 focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4 in-data-[slot=navigation-menu-content]:rounded-sm",
    className,
  )}
  {...restProps}
/>
