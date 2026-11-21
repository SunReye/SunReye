<!--
  Where a chart of equal slots is read (ADR 21 "Chart reading"), on the one pointer reading
  (`chart-reading/`): the slot under the pointer, and one rule at its middle. The caller says the
  slot's values in its legend or row header; no tooltip floats. Laid over the plot alone, never its
  axes, so a slot is a share of what is drawn.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ClassValue, HTMLAttributes } from "svelte/elements";
  import { cn } from "#lib/utils.js";
  import { ChartReader } from "../chart-reading/reader.svelte.ts";
  import ReadingRule from "../chart-reading/ReadingRule.svelte";

  let {
    slots,
    band = (slot) => slot,
    read = $bindable(null),
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, "class" | "children"> & {
    /** How many equal slots the plot is read in, such as its hours. */
    slots: number;
    /** The band a slot lies in, as the sample it reads, where slots are finer than the data. */
    band?: (slot: number) => number;
    /** The index of the slot being read; null with none. */
    read?: number | null;
    class?: ClassValue;
    children?: Snippet;
  } = $props();

  const reading = new ChartReader<number>(
    () => ({
      over: (x) => Math.min(slots - 1, Math.floor(x * slots)),
      band,
    }),
    {
      store: {
        get: () => read,
        set: (at) => {
          read = at;
        },
      },
    },
  );
</script>

<!-- Up and down stays the sheet's scroll. -->
<div
  role="presentation"
  {...rest}
  class={cn("relative touch-pan-y select-none", className)}
  {...reading.on}
>
  {@render children?.()}

  {#if read !== null}
    <!-- At the slot's middle, where an hour's line points and its bar stands. -->
    <ReadingRule share={(read + 0.5) / slots} />
  {/if}
</div>
