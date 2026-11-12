<!-- PROTOTYPE: the battery's cycles and its usable capacity, inferred from SOC over each full discharge: there is no vendor health register. -->
<script lang="ts">
  import TrendChart, { type TrendRow } from "./TrendChart.svelte";
  import { batteryHealth, fmtDay } from "./query";
  import { delta, num } from "./format";
  import type { Q } from "./route";

  let { q, height = 200 }: { q: Q; height?: number } = $props();
  const b = $derived(batteryHealth(q.h));
  const rows = $derived.by((): TrendRow[] => {
    const n = b.points.length;
    if (n < 2) return [];
    // Least squares through the measurements: the trend, not the noise.
    const t0 = b.points[0]!.date.getTime();
    const xs = b.points.map((p) => (p.date.getTime() - t0) / 86_400_000);
    const mx = xs.reduce((a, v) => a + v, 0) / n;
    const my = b.points.reduce((a, p) => a + p.kwh, 0) / n;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (b.points[i]!.kwh - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    return b.points.map((p, i) => ({ x: p.date, kwh: p.kwh, trend: my + slope * (xs[i]! - mx) }));
  });
  const before = $derived(q.h.batteryFrom !== null && q.sel.to <= q.h.batteryFrom);
</script>

<div class="flex flex-col gap-4">
  <dl class="grid grid-cols-2 border-y border-border/60 @[640px]:grid-cols-4 @[640px]:divide-x @[640px]:divide-border/60">
    {#each [
      ["Nutzbare Kapazität", b.nowKwh === null ? "–" : `≈ ${num(b.nowKwh, 1)} kWh`, b.nowKwh === null ? "noch keine Messung" : `${num((b.nowKwh / q.h.nameplateKwh) * 100)} % von ${num(q.h.nameplateKwh)} kWh Nennkapazität`],
      ["Veränderung im Jahr", b.perYear === null ? "–" : delta(b.perYear), b.perYear === null ? "braucht ein halbes Jahr Messungen" : "aus dem Trend der Messungen"],
      ["Vollzyklen gesamt", num(b.cycles), `seit ${q.h.batteryFrom === null ? "–" : fmtDay(q.h, q.h.batteryFrom, true)}`],
      ["Vollzyklen im Zeitraum", before ? "–" : num(q.tot.discharge! / q.h.nameplateKwh, 1), before ? "die Batterie kam später" : `${num(q.tot.discharge!)} kWh entladen`],
    ] as [k, v, sub], i (k)}
      <div class={["flex min-w-0 flex-col gap-0.5 py-2.5 @[640px]:px-3 @[640px]:first:pl-0", i % 2 === 1 && "pl-3", i > 1 && "border-t border-border/60 @[640px]:border-t-0"]}>
        <dt class="truncate text-xs text-muted-foreground">{k}</dt>
        <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{q.loading ? "–" : v}</dd>
        <dd class="text-xs text-muted-foreground tabular-nums">{sub}</dd>
      </div>
    {/each}
  </dl>
  {#if rows.length > 1}
    <TrendChart
      {rows}
      series={[
        { key: "kwh", label: "Messung je vollständiger Entladung", colour: "var(--e-battery)", kind: "points" },
        { key: "trend", label: "Trend", colour: "var(--e-battery)", kind: "line" },
      ]}
      rules={[{ y: q.h.nameplateKwh, label: "Nennkapazität" }]}
      fmt={(v) => `${num(v, 1)} kWh`}
      axisFmt={(v) => num(v, 1)}
      unit="kWh"
      yMin={null}
      {height}
      label="Nutzbare Kapazität der Batterie über die Zeit"
    />
  {:else}
    <div class="flex min-h-[200px] flex-col justify-center gap-2">
      <h3 class="text-base font-semibold">Noch keine Kapazitätsmessung</h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">Eine Messung entsteht, wenn die Batterie in einem Zug von voll auf leer entlädt. Ab zwei Messungen erscheint hier der Verlauf.</p>
    </div>
  {/if}
  <p class="max-w-[68ch] text-xs text-muted-foreground">Geschätzt aus dem Ladezustand: entladene Energie geteilt durch den SOC-Hub. Der Wechselrichter meldet keinen eigenen Gesundheitswert, daher „≈“. Die Kapazität gilt für die ganze Aufzeichnung, nicht nur für den gewählten Zeitraum.</p>
</div>
