<!-- The baseline every change on the screen is measured against: the period before, or last year. -->
<script lang="ts">
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Range } from "../range/range.ts";
  import type { Compare } from "./view.ts";
  import { previousLabel } from "./words.ts";

  let { range, cmp, onchange }: { range: Range; cmp: Compare; onchange: (cmp: Compare) => void } =
    $props();
</script>

{#if range.kind === "year"}
  <span>{m.stats_compare_year_only()}</span>
{:else}
  <span class="max-sm:sr-only">{m.stats_compare()}</span>
  <Segmented
    options={[
      ["prev", previousLabel(range)],
      ["year", m.stats_prev_year()],
    ]}
    value={cmp}
    label={m.stats_compare()}
    {onchange}
  />
{/if}
