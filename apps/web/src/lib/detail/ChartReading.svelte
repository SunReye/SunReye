<!--
  Where a chart is read (ADR 21 "Chart reading"): the pointer, or a finger held on it, reads the
  slot under it, and one rule stands at that slot's middle. The caller says the slot's values in
  its legend or row header; no tooltip floats. Laid over the plot alone, never its axes, so a slot
  is a share of what is drawn.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ClassValue, HTMLAttributes } from "svelte/elements";
  import { PointerReading } from "./pointer-reading.ts";

  let {
    slots,
    read = $bindable(null),
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, "class" | "children"> & {
    /** How many equal slots the plot is read in, such as its hours. */
    slots: number;
    /** The index of the slot being read; null with none. */
    read?: number | null;
    class?: ClassValue;
    children?: Snippet;
  } = $props();

  const reading = new PointerReading(
    () => slots,
    () => read,
    (at) => (read = at),
  );
</script>

<!-- A held finger leads across the plot; up and down stays the sheet's scroll, and while it reads
  the drawer leaves the finger alone. -->
<div
  {...rest}
  class={["relative touch-pan-y select-none", className]}
  role="presentation"
  data-vaul-no-drag={read === null ? undefined : ""}
  onpointerdown={reading.down}
  onpointermove={reading.move}
  onpointerup={reading.up}
  onpointercancel={reading.end}
  onpointerleave={reading.end}
>
  {@render children?.()}

  {#if read !== null}
    <!-- At the slot's middle, where an hour's line points and its bar stands. -->
    <span
      class="pointer-events-none absolute inset-y-0 w-px bg-foreground/60"
      style:left="{((read + 0.5) / slots) * 100}%"
      data-read
    ></span>
  {/if}
</div>
