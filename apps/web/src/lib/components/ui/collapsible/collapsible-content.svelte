<script lang="ts">
  import { Collapsible as CollapsiblePrimitive } from "bits-ui";
  // Local: height transition on --motion-base (#8, ADR 0003).
  import { cn } from "@sunreye/ui/utils";

  // Local: `class` is merged with the height transition below.
  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: CollapsiblePrimitive.ContentProps = $props();
</script>

<CollapsiblePrimitive.Content
  bind:ref
  data-slot="collapsible-content"
  class={cn(
    // Local: height transition (#8): tw-animate's collapsible keyframes on --bits-collapsible-content-height, timed and eased by the motion item, 0 under reduced motion (#38).
    "data-open:animate-collapsible-down data-closed:animate-collapsible-up overflow-hidden duration-(--motion-base) ease-(--motion-ease)",
    className,
  )}
  {...restProps}
/>
