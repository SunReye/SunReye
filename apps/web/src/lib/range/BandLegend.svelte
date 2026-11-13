<!--
  The chart's legend and readout in one (ADR 21): the range's sums, or the values of the band being
  read, so nothing floats under a finger. Sized for its fullest state, so reading a band shifts nothing.
-->
<script lang="ts" module>
  import type { SeriesMeta } from "./bands.ts";

  export interface Legend {
    title: string;
    /** What the band being read is, beside its title. */
    status: string;
    /** Offer to open the band being read. */
    open: boolean;
    /** The upper side's row, then the lower side's, each with its series' values. */
    rows: {
      name: string;
      series: readonly SeriesMeta[];
      values: readonly number[];
      mark: boolean;
    }[];
    /** The reference, kept in the row so one that comes or goes fades instead of reflowing it. */
    mark: { label: string; on: boolean; value: number | null } | null;
    /** The faint bars of bands still to come. */
    ghost: { label: string; colour: string; value: number | null } | null;
    /** The dashed line over the bars. */
    line: { label: string; colour: string; value: number | null } | null;
    /** Figures show a dash: still loading, or a band without readings. */
    blank: boolean;
    /** Reading a band is instant; a new range rolls. */
    duration: number;
  }
</script>

<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import AnimatedNumber from "../components/animated-number.svelte";

  let {
    legend,
    fmt,
    drillLabel,
    onopen,
  }: { legend: Legend; fmt: (v: number) => string; drillLabel: string; onopen: () => void } =
    $props();

  /** A legend row, with the reference and the faint bars on the upper side's row only. */
  type Row = Legend["rows"][number] & {
    reference: Legend["mark"];
    expected: Legend["ghost"];
    curve: Legend["line"];
  };

  const rows = $derived<Row[]>(
    legend.rows.map((r) =>
      Object.assign({}, r, {
        reference: r.mark ? legend.mark : null,
        expected: r.mark ? legend.ghost : null,
        curve: r.mark ? legend.line : null,
      }),
    ),
  );
</script>

{#snippet figure(v: number | null | undefined)}
  <AnimatedNumber
    value={legend.blank ? null : (v ?? 0)}
    format={fmt}
    placeholder="–"
    duration={legend.duration}
    appear={false}
  />
{/snippet}

{#snippet reference(mark: NonNullable<Legend["mark"]>)}
  <div class={["key flex items-baseline gap-1.5", !mark.on && "off"]} aria-hidden={!mark.on}>
    <span class="h-0.5 w-2.5 shrink-0 translate-y-[-3px] bg-foreground"></span>
    <dt class="text-muted-foreground">{mark.label}</dt>
    {#if mark.value !== null}
      <dd class="font-semibold whitespace-nowrap tabular-nums">{@render figure(mark.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet expected(ghost: NonNullable<Legend["ghost"]>)}
  <div class="flex items-baseline gap-1.5">
    <span
      class="size-2 shrink-0 translate-y-[-1px] rounded-[1px] opacity-30"
      style:background={ghost.colour}
    ></span>
    <dt class="text-muted-foreground">{ghost.label}</dt>
    {#if ghost.value !== null}
      <dd class="font-semibold whitespace-nowrap tabular-nums">{fmt(ghost.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet dashed(line: NonNullable<Legend["line"]>)}
  <div class="flex items-baseline gap-1.5">
    <span
      class="h-0 w-3 shrink-0 translate-y-[-3px] border-t border-dashed"
      style:border-color={line.colour}
    ></span>
    <dt class="text-muted-foreground">{line.label}</dt>
    {#if line.value !== null}
      <dd class="font-semibold whitespace-nowrap tabular-nums">{@render figure(line.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet row(r: Row)}
  <!-- Narrow: two columns, the upper side's row above the lower side's, as in the plot. -->
  <dl
    class="grid grid-cols-2 items-baseline gap-x-3 gap-y-0.5 text-xs @[520px]:flex @[520px]:flex-wrap @[520px]:gap-x-4"
  >
    {#if r.name}
      <dt class="hidden w-[4.75rem] shrink-0 text-muted-foreground @[520px]:block">{r.name}</dt>
    {/if}
    {#each r.series as s, i (s.label)}
      <div class="flex min-w-0 items-baseline gap-1.5">
        <span class="size-2 shrink-0 translate-y-[-1px] rounded-[1px]" style:background={s.colour}
        ></span>
        <dt class="truncate text-muted-foreground">{s.label}</dt>
        <dd class="font-semibold whitespace-nowrap tabular-nums">{@render figure(r.values[i])}</dd>
      </div>
    {/each}
    {#if r.reference}{@render reference(r.reference)}{/if}
    {#if r.expected}{@render expected(r.expected)}{/if}
    {#if r.curve}{@render dashed(r.curve)}{/if}
  </dl>
{/snippet}

<div class="flex min-h-[4.5rem] flex-col gap-1 pointer-coarse:min-h-[5.25rem]" aria-live="polite">
  <div class="flex h-7 items-center justify-between gap-3 pointer-coarse:h-10">
    <p class="min-w-0 truncate text-sm font-medium">
      {legend.title}{#if legend.status}<span class="font-normal text-muted-foreground">
          · {legend.status}</span
        >{/if}
    </p>
    {#if legend.open}
      <Button
        variant="outline"
        size="sm"
        class="h-7 shrink-0 gap-1 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-3"
        onclick={onopen}>{drillLabel}<ArrowRight class="size-3.5" /></Button
      >
    {/if}
  </div>
  {#each rows as r (r.name + r.series.length)}
    {@render row(r)}
  {/each}
</div>

<style>
  .key {
    transition: opacity 200ms var(--motion-ease);
  }
  .key.off {
    opacity: 0;
  }
</style>
