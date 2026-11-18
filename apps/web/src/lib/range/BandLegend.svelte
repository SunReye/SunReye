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
      /** Which side of the baseline: a series that runs both ways has a row on each. */
      side: "up" | "down";
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
    /** What a hatched band is, while the plot has one. */
    gap: string | null;
    /** Figures show a dash: still loading, or a band without readings. */
    blank: boolean;
    /** The series' keys state no value. */
    bare: boolean;
    /** The series' figures show a dash: a band still to come, read for its forecast only. */
    unmeasured: boolean;
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
    gap: Legend["gap"];
  };

  const KEY = "flex min-w-0 items-baseline gap-1.5";

  /** At the row's right edge on a phone, beside its key from 520 px. */
  const VALUE = "ml-auto pl-3 font-semibold whitespace-nowrap tabular-nums @[520px]:ml-0 @[520px]:pl-0";

  const rows = $derived<Row[]>(
    legend.rows.map((r) =>
      Object.assign({}, r, {
        reference: r.mark ? legend.mark : null,
        expected: r.mark ? legend.ghost : null,
        curve: r.mark ? legend.line : null,
        gap: r.mark ? legend.gap : null,
      }),
    ),
  );
</script>

{#snippet figure(v: number | null | undefined, series = false)}
  <AnimatedNumber
    value={legend.blank || (series && legend.unmeasured) ? null : (v ?? 0)}
    format={fmt}
    placeholder="–"
    duration={legend.duration}
    appear={false}
  />
{/snippet}

{#snippet reference(mark: NonNullable<Legend["mark"]>)}
  <div class={["key", KEY, !mark.on && "off"]} aria-hidden={!mark.on}>
    <span class="h-0.5 w-2.5 shrink-0 translate-y-[-3px] bg-foreground"></span>
    <dt class="whitespace-nowrap text-muted-foreground">{mark.label}</dt>
    {#if mark.value !== null}
      <dd class={VALUE}>{@render figure(mark.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet expected(ghost: NonNullable<Legend["ghost"]>)}
  <div class={KEY}>
    <span
      class="size-2 shrink-0 translate-y-[-1px] rounded-[1px] opacity-30"
      style:background={ghost.colour}
    ></span>
    <dt class="whitespace-nowrap text-muted-foreground">{ghost.label}</dt>
    {#if ghost.value !== null}
      <dd class={VALUE}>{fmt(ghost.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet dashed(line: NonNullable<Legend["line"]>)}
  <div class={KEY}>
    <span
      class="h-0 w-3 shrink-0 translate-y-[-3px] border-t border-dashed"
      style:border-color={line.colour}
    ></span>
    <dt class="whitespace-nowrap text-muted-foreground">{line.label}</dt>
    {#if line.value !== null}
      <dd class={VALUE}>{@render figure(line.value)}</dd>
    {/if}
  </div>
{/snippet}

{#snippet hatched(label: string)}
  <div class={KEY}>
    <span class="hatch size-2 shrink-0 translate-y-[-1px]"></span>
    <dt class="whitespace-nowrap text-muted-foreground">{label}</dt>
  </div>
{/snippet}

{#snippet row(r: Row)}
  <!--
    The upper side's row above the lower side's, as in the plot. On a phone a row is a list, a key
    per line with its value at the right edge: keys of unequal length wrapped raggedly side by side.
  -->
  <dl
    class="flex flex-col gap-y-0.5 text-[13px] leading-[1.125rem] @[520px]:flex-row @[520px]:flex-wrap @[520px]:items-baseline @[520px]:gap-x-4 @[520px]:text-xs"
  >
    {#if r.name}
      <!-- Named on a phone too, on a line of its own: which side of the baseline is what. -->
      <dt class="text-[11px] font-medium text-muted-foreground @[520px]:w-[4.75rem] @[520px]:shrink-0 @[520px]:text-xs @[520px]:font-normal">
        {r.name}
      </dt>
    {/if}
    {#each r.series as s, i (s.label)}
      <div class={KEY}>
        <span class="size-2 shrink-0 translate-y-[-1px] rounded-[1px]" style:background={s.colour}
        ></span>
        <dt class="truncate text-muted-foreground">{s.label}</dt>
        {#if !legend.bare}
          <dd class={VALUE}>{@render figure(r.values[i], true)}</dd>
        {/if}
      </div>
    {/each}
    {#if r.expected}{@render expected(r.expected)}{/if}
    {#if r.curve}{@render dashed(r.curve)}{/if}
    {#if r.gap}{@render hatched(r.gap)}{/if}
    <!-- Last: it keeps its line while it is faded out, which must not part the keys. -->
    {#if r.reference}{@render reference(r.reference)}{/if}
  </dl>
{/snippet}

<div class="flex min-h-[4.5rem] flex-col gap-1.5 pointer-coarse:min-h-[5.25rem] @[520px]:gap-1" aria-live="polite">
  <div class="flex h-7 items-center justify-between gap-3 pointer-coarse:h-10">
    <p class="min-w-0 truncate text-base font-semibold tabular-nums">
      {legend.title}{#if legend.status}<span class="font-normal text-muted-foreground"
        >&nbsp;· {legend.status}</span
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
  {#each rows as r (r.side)}
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
  /* The plot's hatch for a band without readings, at the swatch's size. */
  .hatch {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--foreground) 45%, transparent) 0 1px,
      transparent 1px 3px
    );
  }
</style>
