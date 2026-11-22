<!-- Local: a `dense` size: one muted line at the top left of a list. -->
<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const emptyVariants = tv({
    base: "group/empty flex w-full min-w-0 flex-col text-balance",
    variants: {
      size: {
        default:
          "flex-1 items-center justify-center gap-4 rounded-lg border-dashed p-12 text-center",
        dense: "items-start gap-1 px-5 py-3 text-left",
      },
    },
    defaultVariants: { size: "default" },
  });

  export type EmptySize = VariantProps<typeof emptyVariants>["size"];
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "#lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    // Local: the `dense` size.
    size = "default",
    children,
    ...restProps
    // Local: props type gains the `dense` size.
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: EmptySize } = $props();
</script>

<div
  bind:this={ref}
  data-slot="empty"
  // Local: data-size and classes from emptyVariants (the `dense` size).
  data-size={size}
  class={cn(emptyVariants({ size }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
