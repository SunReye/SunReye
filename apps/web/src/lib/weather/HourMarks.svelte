<!-- Marks over a day's hours, each at its hour's left edge (ADR 23 "Dashboard"): every third
  hour, as many as a phone's width holds. While an hour is read, its three hours' mark is its own. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Hour } from "./hourly.ts";

  let {
    hours,
    span,
    read,
    class: className,
    mark,
  }: {
    hours: readonly Hour[];
    span: readonly [number, number];
    /** The index of the hour being read; null with none. */
    read: number | null;
    class: string;
    /** An hour's mark, and whether it is the hour being read. */
    mark: Snippet<[Hour, boolean]>;
  } = $props();

  const EVERY = 3;

  /** Each third hour's place, and the hour marked there. */
  const shown = $derived(
    hours.flatMap((first, i) => {
      if (i % EVERY !== 0) return [];

      const marks = read !== null && read - (read % EVERY) === i;

      return [{ first, hour: (marks ? hours[read] : undefined) ?? first, marks }];
    }),
  );
</script>

<div class={["relative w-full", className]}>
  {#each shown as { first, hour, marks } (first.at)}
    <span
      class="absolute inset-y-0 flex flex-col items-start justify-between"
      style:left="{((first.at - span[0]) / (span[1] - span[0])) * 100}%"
    >
      {@render mark(hour, marks)}
    </span>
  {/each}
</div>
