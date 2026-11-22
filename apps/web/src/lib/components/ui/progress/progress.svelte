<!-- Local: a `size` variant (default, square, hairline) and a `tone`: the fill in an energy or diverging colour where the bar carries data (ADR 21, #750). -->
<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const progressVariants = tv({
    base: "bg-muted relative flex w-full items-center overflow-hidden",
    variants: {
      size: {
        default: "h-1.5 rounded-sm",
        square: "h-1.5 rounded-none",
        hairline: "h-1 rounded-none",
      },
    },
    defaultVariants: {
      size: "default",
    },
  });

  // Local: the fill's colour; brand by default, a flow's colour or the diverging pair for data.
  export const progressTones = {
    brand: "bg-primary",
    solar: "bg-solar",
    battery: "bg-battery",
    import: "bg-import",
    export: "bg-export",
    house: "bg-house",
    ev: "bg-ev",
    under: "bg-under",
    over: "bg-over",
  } as const;

  export type ProgressTone = keyof typeof progressTones;

  export type ProgressSize = VariantProps<typeof progressVariants>["size"];
</script>

<script lang="ts">
  import { Progress as ProgressPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    max = 100,
    value = null,
    // Local: the `size` variant.
    size = "default",
    // Local: the `tone`.
    tone = "brand",
    ...restProps
    // Local: props type gains the `size` variant.
  }: WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
    size?: ProgressSize;
    tone?: ProgressTone;
  } = $props();
</script>

<ProgressPrimitive.Root
  bind:ref
  data-slot="progress"
  // Local: classes from progressVariants (the `size` variant).
  class={cn(progressVariants({ size }), className)}
  {value}
  {max}
  {...restProps}
>
  <div
    data-slot="progress-indicator"
    // Local: the fill glides to a new value on --motion-slow, as a transform only (upstream's transition-all would also animate size), #38.
    class={[progressTones[tone], "size-full flex-1 transition-transform duration-(--motion-slow)"]}
    style="transform: translateX(-{100 - (100 * (value ?? 0)) / (max ?? 1)}%)"
  ></div>
</ProgressPrimitive.Root>
