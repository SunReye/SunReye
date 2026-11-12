<!--
  PROTOTYPE: the installer's view (ADR 17). Strings compared by specific yield and by measured over
  modelled, each with its monthly trend; the chosen one shows the correction the plant learned per
  month and hour. A table, because strings are compared across the same attributes.
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Info from "@lucide/svelte/icons/info";
  import HeatGrid from "./HeatGrid.svelte";
  import { correction, selLabel, type StringRow } from "./query";
  import { num } from "./format";
  import { haptics } from "../haptics";
  import type { Q } from "./route";

  let { q, rows, sid, onpick }: { q: Q; rows: StringRow[]; sid: string | null; onpick: (id: string) => void } = $props();

  const picked = $derived(rows.find((r) => r.id === sid) ?? rows.find((r) => r.flag === "weak") ?? rows[0]!);
  const index = $derived(rows.indexOf(picked));
  const grid = $derived(correction(q.h, index));
  const best = $derived(Math.max(...rows.map((r) => r.perKwp), 0.001));
  const ratioText = (v: number | null) => (v === null ? "–" : `${num(v * 100)} %`);

  // Two hues around a neutral middle: under the model, over the model. Steps of a fifth.
  const fill = (v: number) => {
    const d = Math.max(-1, Math.min(1, (v - 1) / 0.2));
    const step = Math.round(Math.abs(d) * 5) * 20;
    return `color-mix(in oklab, var(${d < 0 ? "--under" : "--over"}) ${step}%, color-mix(in oklab, var(--foreground) 9%, transparent))`;
  };
  function spark(trend: (number | null)[]): string {
    const pts = trend.map((v, i) => (v === null ? null : `${((i / Math.max(1, trend.length - 1)) * 60).toFixed(1)},${(20 - ((Math.min(1.15, Math.max(0.75, v)) - 0.75) / 0.4) * 20).toFixed(1)}`));
    return pts.filter(Boolean).join(" ");
  }
</script>

<div class="panel flex flex-col gap-4">
  <div role="table" aria-label="Strings im Vergleich" class="text-sm">
    <div role="row" class="cols border-b border-border/60 pb-1.5 text-xs text-muted-foreground">
      <span role="columnheader">String</span>
      <span role="columnheader" class="text-right">kWh je kWp</span>
      <span role="columnheader" class="text-right">Ist zu Modell</span>
      <span role="columnheader" class="trend text-right">18 Monate</span>
    </div>
    {#each rows as r (r.id)}
      <button
        type="button"
        role="row"
        aria-selected={r.id === picked.id}
        class={["cols line w-full border-b border-border/60 py-2 text-left", r.id === picked.id && "bg-foreground/[0.05]"]}
        onclick={() => {
          if (r.id !== picked.id) haptics.selection();
          onpick(r.id);
        }}
      >
        <span role="cell" class="flex min-w-0 items-start gap-1.5">
          {#if r.flag === "weak"}<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warnung" />{:else if r.flag === "face"}<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Hinweis" />{/if}
          <span class="min-w-0">
            <span class="line-clamp-2 font-medium">{r.name}</span>
            <span class="block truncate text-xs text-muted-foreground tabular-nums">{num(r.kwp, 1)} kWp · {num(r.kwh)} kWh{r.estimated ? " · geschätzt" : ""}</span>
          </span>
        </span>
        <span role="cell" class="flex flex-col items-end gap-1">
          <span class="font-semibold tabular-nums">{q.loading ? "–" : num(r.perKwp, r.perKwp < 100 ? 1 : 0)}</span>
          <span class="h-1 w-full max-w-24 bg-foreground/10"><span class="block h-full bg-solar" style:width="{(r.perKwp / best) * 100}%"></span></span>
        </span>
        <span role="cell" class="text-right font-semibold tabular-nums">{q.loading ? "–" : ratioText(r.ratio)}</span>
        <span role="cell" class="trend flex justify-end">
          <svg viewBox="0 0 60 20" class="h-5 w-[60px] overflow-visible" aria-hidden="true">
            <line x1="0" x2="60" y1="7.5" y2="7.5" class="stroke-foreground/20" stroke-width="1" />
            <polyline points={spark(r.trend)} fill="none" class="stroke-foreground" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </span>
      </button>
    {/each}
    <p class="pt-2 text-xs text-muted-foreground">Werte für {selLabel(q.h, q.sel)}. „Geschätzt“: Strings an einem gemeinsamen MPPT-Eingang werden zusammen gemessen und nach modelliertem Strom geteilt.</p>
  </div>

  <section class="flex flex-col gap-2 border-t border-border/60 pt-3" aria-label="Korrektur">
    <h3 class="text-sm font-semibold">Korrektur MPPT-Eingang {picked.mppt} <span class="font-normal text-muted-foreground">· {picked.name} · letzte 12 Monate</span></h3>
    {#if picked.note}
      <p class="flex max-w-[68ch] items-start gap-2 text-sm text-pretty">
        {#if picked.flag === "weak"}<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />{:else}<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" />{/if}
        {picked.note}
      </p>
    {/if}
    {#if q.fresh}
      <p class="py-6 text-sm text-muted-foreground">Die Korrektur lernt aus abgeschlossenen Tagen, drei Tage nachdem das Archivwetter feststeht. Das Raster füllt sich Monat für Monat.</p>
    {:else}
      <HeatGrid
        cols={grid.cols.map((c) => ({ label: c, tick: true, title: c }))}
        cells={grid.cells}
        colour={fill}
        describe={(v) => (v === null ? "zu wenig Sonne zum Lernen" : `gemessen ${num(v * 100)} % des Modells`)}
        idle="Gemessen geteilt durch modelliert, je Monat und Stunde"
        label="Korrektur nach Monat und Tageszeit"
        blank
      />
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-10 text-xs text-muted-foreground tabular-nums">
        <span>80 %</span>
        <span class="flex h-2 w-40 gap-px">{#each [0.8, 0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.08, 1.12, 1.16, 1.2] as v (v)}<span class="flex-1" style:background={fill(v)}></span>{/each}</span>
        <span>120 % des Modells</span>
      </div>
    {/if}
  </section>
</div>

<style>
  .panel {
    /* Not energy flows, so neither pole is an energy colour. */
    --under: oklch(0.7 0.16 45);
    --over: oklch(0.72 0.11 235);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.5rem 5.5rem;
    column-gap: 0.75rem;
    align-items: center;
    padding-inline: 0.25rem;
  }
  .trend {
    display: none;
  }
  @container (min-width: 520px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) 7rem 6.5rem 5rem;
      column-gap: 1.25rem;
    }
    .trend {
      display: flex;
    }
  }
  .line {
    outline: none;
  }
  .line:hover {
    background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
  }
  .line:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
</style>
