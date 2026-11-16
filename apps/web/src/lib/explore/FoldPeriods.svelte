<!-- What the fold is cut by (ADR 22): the periods the range holds several of. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import type { Period } from "../api/core.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { indicator } from "../range/indicator.ts";

  let {
    offered,
    period,
    onchange,
  }: { offered: readonly Period[]; period: Period; onchange: (period: Period) => void } = $props();

  const id = $props.id();

  const NAMES: Readonly<Record<Period, () => string>> = {
    hour: m.explore_fold_hours,
    day: m.explore_fold_days,
    week: m.explore_fold_weeks,
    month: m.explore_fold_months,
  };
</script>

<div class="flex items-center gap-2 text-xs text-muted-foreground">
  <span {id}>{m.explore_fold_by()}</span>
  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    class="data-indicator:before:hidden!"
    aria-labelledby={id}
    bind:value={
      () => period,
      (v: string) => {
        const next = offered.find((each) => each === v);

        if (next === undefined || next === period) return;

        haptics.selection();
        onchange(next);
      }
    }
  >
    <span class="rounded-[2px] bg-foreground/[0.13]" {@attach indicator('[data-state="on"]')}
    ></span>
    {#each offered as id (id)}
      <ToggleGroup.Item value={id} class="px-2.5 text-xs">{NAMES[id]()}</ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>
