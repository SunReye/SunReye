<!-- The baseline every change on the screen is measured against: the period before, or last year. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { indicator } from "../range/indicator.ts";
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
  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    class="data-indicator:before:hidden!"
    aria-label={m.stats_compare()}
    bind:value={
      () => cmp,
      (v: string) => {
        if (!v || v === cmp) return;
        haptics.selection();
        onchange(v === "year" ? "year" : "prev");
      }
    }
  >
    <span class="pill" {@attach indicator('[data-state="on"]')}></span>
    <ToggleGroup.Item value="prev" class="px-2.5 text-xs">{previousLabel(range)}</ToggleGroup.Item>
    <ToggleGroup.Item value="year" class="px-2.5 text-xs">{m.stats_prev_year()}</ToggleGroup.Item>
  </ToggleGroup.Root>
{/if}

<style>
  .pill {
    border-radius: 2px;
    background: color-mix(in oklab, var(--foreground) 13%, transparent);
  }
</style>
