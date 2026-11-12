<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";

  let {
    label,
    value,
    unit = "kWh",
    colour,
    onclick,
    sub,
    class: className = "",
  }: {
    label: string;
    value: number;
    unit?: string;
    colour: string;
    onclick?: () => void;
    sub?: Snippet;
    class?: string;
  } = $props();
</script>

<Card.Root
  size="sm"
  interactive
  role="button"
  tabindex={0}
  {onclick}
  onkeydown={(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && onclick?.()}
  class="glass-ambient min-w-0 gap-1 py-2.5 {className}"
>
  <Card.Header class="gap-1">
    <Card.Description class="flex items-center gap-1.5 text-xs font-medium">
      <span class="size-1.5 rounded-full" style:background={colour}></span>{label}
    </Card.Description>
    <span class="text-[22px] leading-none font-semibold tracking-tight">
      <AnimatedNumber {value} digits={1} /><span class="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>
    </span>
  </Card.Header>
  {#if sub}<Card.Content class="truncate text-xs text-muted-foreground">{@render sub()}</Card.Content>{/if}
</Card.Root>
