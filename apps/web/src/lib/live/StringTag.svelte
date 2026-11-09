<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { StringLabel } from "./labels.ts";

  let {
    string,
    at,
    format,
  }: {
    string: StringLabel;
    /** Pixels on the canvas. */
    at: readonly [number, number];
    format: Intl.NumberFormat;
  } = $props();

  const text = $derived.by(() => {
    const { name, watts } = string;

    if (watts === null) return m.live_string_none({ name });

    // An SI symbol, the same in every locale.
    const power = `${format.format(watts)} W`;

    return string.estimated
      ? m.live_string_estimated({ name, power })
      : m.live_string({ name, power });
  });
</script>

<output style:left="{at[0]}px" style:top="{at[1]}px">{text}</output>

<style>
  output {
    position: absolute;
    translate: -50% -50%;
    pointer-events: none;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: #fffffff0;
    color: #1d232b;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
