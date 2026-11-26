<!-- A trend chart's legend; it reads the values under the pointer, as no tooltip floats (ADR 21). -->
<script lang="ts">
  import { isValue, type TrendRow, type TrendRule, type TrendSeries } from "./trend.ts";

  let {
    series,
    rules,
    unit,
    read,
    fmt,
    day,
  }: {
    series: readonly TrendSeries[];
    rules: readonly TrendRule[];
    unit: string;
    /** The row under the pointer. */
    read: TrendRow | null;
    fmt: (v: number) => string;
    day: (d: Readonly<Date>) => string;
  } = $props();

  /** A dot for points, a stroke for lines. */
  const swatch = (k: TrendSeries["kind"]) => [
    k === "points" ? "size-2 rounded-full bg-current" : "w-3 border-t-2",
    k === "dashed" && "border-dashed",
  ];

  /** The series' value under the pointer, written; null where it has none. */
  function at(key: string): string | null {
    const v = read?.values[key];

    return isValue(v) ? fmt(v) : null;
  }
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
  {#if read}
    <li class="font-medium text-foreground tabular-nums">{day(read.x)}</li>
  {/if}
  {#each series as s (s.key)}
    {@const v = at(s.key)}
    <li class="flex items-center gap-1.5">
      <span class={swatch(s.kind)} style:color={s.colour} style:border-color={s.colour}></span>
      {s.label}
      {#if v !== null}<span class="font-semibold text-foreground tabular-nums">{v}</span>{/if}
    </li>
  {/each}
  {#each rules as r (r.label)}
    <li class="flex items-center gap-1.5">
      <span class="w-3 border-t border-foreground/50"></span>{r.label}
    </li>
  {/each}
  {#if unit}<li class="ml-auto">{unit}</li>{/if}
</ul>
