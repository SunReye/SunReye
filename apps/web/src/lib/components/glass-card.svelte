<!--
  The surface a group of content sits on over the backdrop: ambient glass, the app's corner, a
  hairline border and the first elevation step (`raised`: the second). Opaque under reduced
  transparency and the low-power switch, as every glass (ADR 21).
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    element = "div",
    raised = false,
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    element?: "div" | "section" | "nav" | "ul" | "form";
    raised?: boolean;
    children: Snippet;
  } = $props();
</script>

<svelte:element
  this={element}
  class={[
    "glass-ambient overflow-hidden rounded-lg border border-border/60",
    raised ? "elevation-2" : "elevation-1",
    className,
  ]}
  {...rest}
>
  {@render children()}
</svelte:element>
