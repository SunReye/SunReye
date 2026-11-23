<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "@sunreye/ui/utils";
  // Local: a tab the user picks ticks (ADR 21 "One behaviour, one component").
  import { haptics } from "@sunreye/ui/haptics";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    onValueChange,
    ...restProps
  }: TabsPrimitive.RootProps = $props();
</script>

<!-- Local: bits calls onValueChange only for a trigger's pick of another tab, never for a value set from outside. -->
<TabsPrimitive.Root
  bind:ref
  bind:value
  data-slot="tabs"
  class={cn("gap-2 group/tabs flex data-horizontal:flex-col", className)}
  onValueChange={(next) => {
    haptics.selection();
    onValueChange?.(next);
  }}
  {...restProps}
/>
