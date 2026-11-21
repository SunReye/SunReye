<!--
  Fold mode's chart (ADR 22): the first chosen series' statistics per hour, day, week or month,
  as bars above a sortable table. A status or held value has no fold, and the pane says so.
-->
<script lang="ts">
  import ChartColumn from "@lucide/svelte/icons/chart-column";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import FoldChart from "./FoldChart.svelte";
  import FoldPeriods from "./FoldPeriods.svelte";
  import FoldTable from "./FoldTable.svelte";
  import { Fold } from "./fold.svelte.ts";
  import type { PaneProps } from "./mode.ts";

  let { plotted = $bindable(), ...props }: PaneProps = $props();

  const fold = new Fold(() => props);

  plotted = () => fold.table;

  const { route, height } = $derived(props);
  const chosen = $derived(fold.chosen);
  const got = $derived(fold.got);

  /** The periods' row as laid out, in px. */
  let head = $state(0);

  /** The column's gap-4. */
  const GAP = 16;

  /** Under the periods: in fullscreen all the window leaves, so their row is measured. */
  const rest = $derived(props.full === true && head > 0 ? height - head - GAP : height - 44);

</script>

{#snippet said(title: string, text: string)}
  <Empty.Root style="min-height: {height}px">
    <Empty.Header>
      <Empty.Media variant="icon"><ChartColumn /></Empty.Media>
      <Empty.Title>{title}</Empty.Title>
      <Empty.Description>{text}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{/snippet}

{#if fold.state === "pending"}
  <Skeleton class="w-full rounded-md" style="height: {height}px" />
{:else if fold.state === "none"}
  {@render said(m.explore_fold_no_fold_title(), m.explore_fold_no_fold({ name: chosen.label }))}
{:else if fold.state === "unstored"}
  {@render said(chosen.label, m.explore_fold_unstored({ name: chosen.label }))}
{:else}
  <div class="flex flex-col gap-4">
    <div bind:clientHeight={head}>
      <FoldPeriods offered={fold.periods.offered} period={fold.period} onchange={fold.setPeriod} />
    </div>

    {#if got === null}
      <Skeleton class="w-full rounded-md" style="height: {rest}px" />
    {:else if got.failed}
      <div class="flex flex-col justify-center" style:min-height="{rest}px">
        <LoadFailed text={m.explore_fold_error()} refused={got.refused} onretry={fold.retry} />
      </div>
    {:else if got.rows.length === 0}
      {@render said(chosen.label, m.explore_fold_empty({ name: chosen.label }))}
    {:else}
      <FoldChart
        rows={got.rows}
        period={got.period}
        counter={got.counter}
        unit={chosen.unit}
        from={got.from}
        to={got.to}
        zone={got.zone}
        whole={route.label}
        label={m.explore_fold_chart({ name: chosen.label })}
        height={rest}
      />
      <FoldTable
        rows={got.rows}
        period={got.period}
        counter={got.counter}
        unit={chosen.unit}
        zone={got.zone}
      />
    {/if}
  </div>
{/if}
