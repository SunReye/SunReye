<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";
  import { cn } from "@sunreye/ui/utils";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenubarPrimitive.RootProps = $props();
</script>

<MenubarPrimitive.Root
  bind:ref
  data-slot="menubar"
  // Local: ambient glass with the bevel instead of shadow-xs: a menubar sits on the page (ADR 21, #750).
  class={cn(
    "glass-ambient bevel h-9 touch:h-11 gap-1 rounded-md border p-1 flex items-center",
    className,
  )}
  {...restProps}
/>
