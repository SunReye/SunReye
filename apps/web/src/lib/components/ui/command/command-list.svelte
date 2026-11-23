<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "@sunreye/ui/utils";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: CommandPrimitive.ListProps = $props();
</script>

<CommandPrimitive.List
  bind:ref
  data-slot="command-list"
  class={cn(
    // Local: `scroll-fade-y`, the edges fade where more content waits (ADR 21, #753).
    "no-scrollbar scroll-fade-y max-h-72 scroll-py-1 outline-none overflow-x-hidden overflow-y-auto",
    className,
  )}
  {...restProps}
/>
