<!-- How close the forecast came over the range's whole days (prototype ForecastPanel). -->
<script lang="ts">
  import { accuracyText, type Accuracy } from "../history/forecast.ts";
  import { m } from "../paraglide/messages.js";

  let { accuracy }: { accuracy: Accuracy | null } = $props();

  const acc = $derived(
    accuracyText(accuracy ?? { error: null, bias: null, days: 0 }, accuracy === null),
  );

  const figures = $derived([
    [m.stats_forecast_error(), acc[0]],
    [m.stats_forecast_bias(), acc[1]],
    [m.stats_forecast_days(), acc[2]],
  ] as const);
</script>

<dl class="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
  {#each figures as [term, value], i (term)}
    <div class={["flex min-w-0 flex-col gap-0.5 py-2.5", ["pr-3", "px-3", "pl-3"][i]]}>
      <dt class="text-xs text-pretty text-muted-foreground">{term}</dt>
      <dd class="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  {/each}
</dl>
