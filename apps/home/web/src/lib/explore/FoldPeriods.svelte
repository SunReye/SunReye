<!-- What the fold is cut by (ADR 22): the periods the range holds several of. -->
<script lang="ts">
  import type { Period } from "../api/core.ts";
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";

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
  <Segmented
    options={offered.map((each) => [each, NAMES[each]()] as const)}
    value={period}
    labelledby={id}
    {onchange}
  />
</div>
