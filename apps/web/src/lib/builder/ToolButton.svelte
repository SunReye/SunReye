<!-- One action of the context toolbar (ADR 20): an icon with a short label, a finger's size. -->
<script lang="ts">
  import type { Component } from "svelte";
  import { Button, type ButtonProps } from "@sunreye/ui/button";

  let {
    icon: Icon,
    label,
    ...rest
  }: ButtonProps & {
    icon: Component<{ class?: string }>;
    /** Short enough for a phone's width; `aria-label` says more where it must. */
    label: string;
  } = $props();
</script>

<Button variant="ghost" {...rest} class={["min-h-11 shrink-0 gap-1.5 px-2.5", rest.class]}>
  <Icon class="size-4" />
  <span class="truncate">{label}</span>
</Button>
