<script lang="ts">
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { cn } from "#lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AvatarPrimitive.ImageProps = $props();
</script>

<AvatarPrimitive.Image
  bind:ref
  data-slot="avatar-image"
  // Local: fades in when it finishes loading (bits-ui shows it then, with an animation starting at that moment), on the motion item's duration and easing (#38).
  class={cn(
    "rounded-full aspect-square size-full object-cover animate-in fade-in-0 duration-(--motion-base) ease-(--motion-ease)",
    className,
  )}
  {...restProps}
/>
