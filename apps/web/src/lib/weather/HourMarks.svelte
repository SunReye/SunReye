<!-- Marks over a day's hours, each at its hour's left edge (ADR 23 "Dashboard"): every third
  hour, as many as a phone's width holds. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Hour } from "./hourly.ts";

  let {
    hours,
    span,
    class: className,
    mark,
  }: {
    hours: readonly Hour[];
    span: readonly [number, number];
    class: string;
    mark: Snippet<[Hour]>;
  } = $props();

  const EVERY = 3;

  const shown = $derived(hours.filter((_, i) => i % EVERY === 0));
</script>

<div class={["relative w-full", className]}>
  {#each shown as hour (hour.at)}
    <span
      class="absolute inset-y-0 flex flex-col items-start justify-between"
      style:left="{((hour.at - span[0]) / (span[1] - span[0])) * 100}%"
    >
      {@render mark(hour)}
    </span>
  {/each}
</div>
