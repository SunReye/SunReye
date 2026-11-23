<script lang="ts">
  import { Separator } from "@sunreye/ui/separator";
  import { cn } from "@sunreye/ui/utils";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof Separator> = $props();
</script>

<Separator
  bind:ref
  data-slot="sidebar-separator"
  data-sidebar="separator"
  class={cn("bg-sidebar-border mx-2 w-auto", className)}
  {...restProps}
/>
