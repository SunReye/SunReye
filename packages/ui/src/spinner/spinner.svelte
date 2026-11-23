<script lang="ts">
  import Loader2Icon from "@lucide/svelte/icons/loader-2";
  import { cn } from "../utils.ts";
  import type { SVGAttributes } from "svelte/elements";

  let {
    class: className,
    role = "status",
    // we add name, color, and stroke for compatibility with different icon libraries props.
    // only forward them when set, otherwise `stroke: undefined` overrides the icon's `currentColor`
    name,
    color,
    stroke,
    className: legacyClassName,
    "aria-label": ariaLabel = "Loading",
    ...restProps
  }: SVGAttributes<SVGSVGElement> = $props();
</script>

<!-- Local: the spin stops under reduced motion and on the still tier (ADR 21, #750). -->
<Loader2Icon
  {role}
  {...name != null ? { name } : {}}
  {...color != null ? { color } : {}}
  {...stroke != null ? { stroke } : {}}
  {...legacyClassName != null ? { className: legacyClassName } : {}}
  aria-label={ariaLabel}
  class={cn(
    "size-4 animate-spin motion-reduce:animate-none in-data-[motion=still]:animate-none",
    className,
  )}
  {...restProps}
/>
