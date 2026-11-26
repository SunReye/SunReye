<script lang="ts">
  import type { WithElementRef } from "@sunreye/ui/utils";
  import { cn } from "@sunreye/ui/utils";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<nav
  bind:this={ref}
  data-slot="breadcrumb"
  aria-label="breadcrumb"
  class={cn(className)}
  {...restProps}
>
  {@render children?.()}
</nav>
