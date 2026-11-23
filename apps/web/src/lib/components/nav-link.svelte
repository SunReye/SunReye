<!--
  A link to one of the app's screens (ADR 21 "One behaviour, one component"): the rail's and More's
  rows. Following it to a screen not shown ticks `selection`.
-->
<script lang="ts">
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { haptics } from "@sunreye/ui/haptics";

  let {
    current,
    onclick,
    children,
    ...rest
  }: HTMLAnchorAttributes & {
    /** It leads to the screen shown. */
    current: boolean;
  } = $props();
</script>

<a
  {...rest}
  aria-current={current ? "page" : undefined}
  onclick={(event) => {
    onclick?.(event);

    if (!current) haptics.selection();
  }}
>
  {@render children?.()}
</a>
