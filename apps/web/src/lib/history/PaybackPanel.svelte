<!-- Payback (ADR 12): savings summed since the first against the investment the admin entered, and when they reach it at the core's pace. -->
<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import type { Payback } from "../api/tariff.ts";
  import { m } from "../paraglide/messages.js";
  import { money, num } from "../range/format.ts";
  import { paybackRows, paybackText } from "./payback.ts";
  import TrendChart from "./TrendChart.svelte";

  let { payback, loading, height }: { payback: Payback | null; loading: boolean; height: number } =
    $props();

  const shown = $derived(payback ? paybackText(payback, loading) : null);
  const rows = $derived(payback ? paybackRows(payback) : []);

  const axis = (v: number) => (v >= 1000 ? `${num(v / 1000, 1)} T€` : `${num(v)} €`);
</script>

<div class="flex min-h-[300px] flex-col gap-4">
  {#if shown && payback}
    <div class="flex flex-col gap-2">
      <p class="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
        <span
          class="text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums"
          >{shown.saved}</span
        >
        {shown.of}
        <span class="ml-auto font-semibold text-foreground tabular-nums">{shown.share}</span>
      </p>
      <Progress
        value={shown.progress}
        size="square"
        class="payback"
        aria-label={m.stats_payback()}
      />
      <p class="text-sm text-pretty">
        {shown.forecast.before}{#if shown.forecast.month}<span class="font-semibold"
            >{shown.forecast.month}</span
          >{shown.forecast.after}{/if}
      </p>
    </div>
    {#if rows.length > 2}
      <TrendChart
        {rows}
        series={[
          { key: "saved", label: m.stats_payback_so_far(), colour: "var(--e-solar)", kind: "area" },
          {
            key: "projected",
            label: m.stats_payback_at_pace(),
            colour: "var(--e-solar)",
            kind: "dashed",
          },
        ]}
        rules={payback.investment == null
          ? []
          : [{ y: payback.investment, label: m.stats_payback_investment() }]}
        fmt={money}
        axisFmt={axis}
        {height}
        label={m.stats_payback_chart()}
      />
    {/if}
    <p class="max-w-[68ch] text-xs text-muted-foreground">{m.stats_payback_note()}</p>
  {:else}
    <div class="flex flex-col justify-center gap-2 py-8">
      <h3 class="text-base font-semibold">{m.stats_payback()}</h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_payback_none()}</p>
      <a
        href="#/settings?group=tariff"
        class="self-start text-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:underline"
        >{m.stats_tariff_edit()}</a
      >
    </div>
  {/if}
</div>
