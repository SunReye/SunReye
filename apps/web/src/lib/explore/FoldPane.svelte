<!--
  Fold mode's chart (ADR 22): the first chosen series' statistics per hour, day, week or month,
  as bars above a sortable table. A status or held value has no fold, and the pane says so.
-->
<script lang="ts">
  import ChartColumn from "@lucide/svelte/icons/chart-column";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import FoldChart from "./FoldChart.svelte";
  import FoldPeriods from "./FoldPeriods.svelte";
  import FoldTable from "./FoldTable.svelte";
  import { Fold } from "./fold.svelte.ts";
  import type { ModeProps } from "./mode.ts";

  let { core, route, series, catalog, height }: ModeProps = $props();

  const fold = new Fold(() => ({ core, route, series, catalog }));
  const chosen = $derived(fold.chosen);
  const got = $derived(fold.got);
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
    <FoldPeriods offered={fold.periods.offered} period={fold.period} onchange={fold.setPeriod} />

    {#if got === null}
      <Skeleton class="w-full rounded-md" style="height: {height - 44}px" />
    {:else if got.failed}
      <div
        class="flex flex-col items-start justify-center gap-3"
        style:min-height="{height - 44}px"
        role="alert"
      >
        <p class="text-sm text-muted-foreground">{m.explore_fold_error()}</p>
        <Button
          variant="outline"
          size="sm"
          onclick={fold.retry}>{m.explore_fold_retry()}</Button
        >
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
        height={height - 44}
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
