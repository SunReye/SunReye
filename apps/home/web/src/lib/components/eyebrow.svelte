<!-- The small uppercase heading over a group of rows or fields, as Settings groups them. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    element = "h3",
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    element?: "h2" | "h3" | "legend" | "p";
    children: Snippet;
  } = $props();
</script>

<svelte:element
  this={element}
  class={["text-xs font-medium tracking-wide text-muted-foreground uppercase", className]}
  {...rest}
>
  {@render children()}
</svelte:element>
