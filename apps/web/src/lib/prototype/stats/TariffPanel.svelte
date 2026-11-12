<!-- PROTOTYPE: the prices behind the money (ADR 12): the tariff prices the bill, the spot price is context only. -->
<script lang="ts">
  import TrendChart, { type TrendRow } from "./TrendChart.svelte";
  import { fmtDay, prices } from "./query";
  import { num } from "./format";
  import type { Q } from "./route";

  let { q, height = 200 }: { q: Q; height?: number } = $props();
  const rows = $derived(prices(q.h, q.bs).map((p): TrendRow => ({ x: p.date, imp: p.imp, feedIn: p.feedIn, spot: p.spot })));
  const versions = $derived([...q.h.tariff].reverse());
  const inRange = (from: number, i: number) => from < q.sel.to && (i === 0 ? true : versions[i - 1]!.from > q.sel.from);
</script>

<div class="flex flex-col gap-4">
  {#if rows.length > 1}
    <TrendChart
      {rows}
      series={[
        { key: "imp", label: "Bezugspreis", colour: "var(--e-import)", kind: "step" },
        { key: "feedIn", label: "Einspeisevergütung", colour: "var(--e-export)", kind: "step" },
        { key: "spot", label: "Spotpreis (Mittel, vor Abgaben)", colour: "color-mix(in oklab, var(--foreground) 45%, transparent)", kind: "line" },
      ]}
      fmt={(v) => `${num(v, 1)} ct`}
      axisFmt={(v) => num(v)}
      unit="ct je kWh"
      {height}
      label="Bezugspreis, Einspeisevergütung und Spotpreis über die Zeit"
    />
  {/if}
  <section aria-label="Tarifversionen">
    <h3 class="pb-1 text-xs font-medium text-muted-foreground">Tarif</h3>
    <ul class="divide-y divide-border/60 border-y border-border/60">
      {#each versions as v, i (v.from)}
        <li class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2 text-sm tabular-nums">
          <span class="w-36 font-medium">ab {fmtDay(q.h, v.from, true)}</span>
          <span>Bezug <span class="font-semibold">{num(v.imp, 1)} ct</span></span>
          <span>Einspeisung <span class="font-semibold">{num(v.feedIn, 1)} ct</span></span>
          {#if inRange(v.from, i)}<span class="ml-auto text-xs text-muted-foreground">gilt im Zeitraum</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
  <p class="max-w-[68ch] text-xs text-muted-foreground">Die Rechnung nutzt allein den Tarif. Der Spotpreis ist der Großhandelspreis der Gebotszone DE-LU, ohne Netzentgelte, Abgaben und Steuern. Quelle: energy-charts.info, CC BY 4.0.</p>
</div>
