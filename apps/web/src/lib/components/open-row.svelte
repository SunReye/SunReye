<!--
  A row that opens what it names elsewhere, a chevron at its end (ADR 21 "One behaviour, one
  component"): a note's cause, a peak's day. Its press is a drill-in commit: `soft`.
-->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { Snippet } from "svelte";
  import type { ClassValue } from "svelte/elements";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";

  let {
    label,
    class: className,
    chevron,
    onopen,
    children,
  }: {
    label?: string | undefined;
    class?: ClassValue;
    /** The chevron's own place in the row. */
    chevron?: ClassValue;
    onopen: () => void;
    children: Snippet;
  } = $props();
</script>

<Pressable
  feedback
  class={["flex w-full text-left", className]}
  aria-label={label}
  onclick={() => {
    haptics.soft();
    onopen();
  }}
>
  {@render children()}
  <ChevronRight class={["size-4 shrink-0 text-muted-foreground", chevron]} />
</Pressable>
