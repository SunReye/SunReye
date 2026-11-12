<!-- PROTOTYPE: payback (ADR 12): savings summed since the first against the investment the admin entered. -->
<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import TrendChart, { type TrendRow } from "./TrendChart.svelte";
  import type { Payback } from "./query";
  import { money, percent } from "./format";
  import type { Q } from "./route";

  let { q, pay, height = 200 }: { q: Q; pay: Payback; height?: number } = $props();
  const rows = $derived(pay.points.map((p, i): TrendRow => ({ x: p.date, saved: p.projected ? null : p.saved, projected: p.projected || !pay.points[i + 1] || pay.points[i + 1]!.projected ? p.saved : null })));
  const mf = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-2">
    <p class="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      <span class="text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">{q.loading ? "–" : money(pay.saved)}</span>
      von {money(q.h.investment)} gespart
      <span class="ml-auto font-semibold text-foreground tabular-nums">{q.loading ? "–" : percent(pay.share)}</span>
    </p>
    <Progress value={q.loading ? 0 : pay.share * 100} size="square" class="payback" aria-label="Amortisation" />
    <p class="text-sm text-pretty">
      {#if pay.reached && pay.perYear}
        Beim Tempo der letzten zwölf Monate ({money(pay.perYear)} im Jahr) ist die Investition im <span class="font-semibold">{mf.format(pay.reached)}</span> eingespart.
      {:else}
        Eine Prognose folgt nach drei Monaten Aufzeichnung: bis dahin fehlt ein belastbares Tempo.
      {/if}
    </p>
  </div>
  {#if rows.length > 2}
    <TrendChart
      {rows}
      series={[
        { key: "saved", label: "Ersparnis bisher", colour: "var(--e-solar)", kind: "area" },
        { key: "projected", label: "bei gleichem Tempo", colour: "var(--e-solar)", kind: "dashed" },
      ]}
      rules={[{ y: q.h.investment, label: "Investition" }]}
      fmt={money}
      axisFmt={(v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace(".", ",")} T€` : `${Math.round(v)} €`)}
      {height}
      label="Summierte Ersparnis gegen die Investition"
    />
  {/if}
  <p class="max-w-[68ch] text-xs text-muted-foreground">Nur für Admins sichtbar, weil die Investition genannt wird. Die Ersparnis ist die Rechnung ohne Anlage abzüglich der Rechnung mit ihr, je Stunde zum damals geltenden Tarif.</p>
</div>
