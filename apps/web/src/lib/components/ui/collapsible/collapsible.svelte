<script lang="ts">
  import { Collapsible as CollapsiblePrimitive } from "bits-ui";
  import { haptics } from "@sunreye/ui/haptics";

  let {
    ref = $bindable(null),
    open = $bindable(false),
    ...restProps
  }: CollapsiblePrimitive.RootProps = $props();

  // Local: opening or closing it ticks (ADR 21 "One behaviour, one component"). bits-ui writes
  // `open` on a user's press only. After the caller.
  function toggle(next: boolean): void {
    open = next;
    haptics.selection();
  }
</script>

<CollapsiblePrimitive.Root
  bind:ref
  bind:open={() => open, toggle}
  data-slot="collapsible"
  {...restProps}
/>
