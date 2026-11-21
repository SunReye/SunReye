<!--
  How well one inverter's forecast held over the route's range (ADR 17, 21): a headline answer
  first, then measured production as bars with the forecast as a mark on each, what is still
  expected as faint bars, and how close the forecast came. One line at a time: the total, an MPPT
  input or a string.
-->
<script lang="ts">
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import RangePane from "../range/RangePane.svelte";
  import { stackOf, type Line } from "./forecast.ts";
  import { ForecastData, type ForecastInput } from "./forecast-data.svelte.ts";
  import ForecastPane from "./ForecastPane.svelte";
  import LinePicker from "./LinePicker.svelte";

  let {
    core,
    device,
    lines,
    route,
  }: Pick<ForecastInput, "core" | "device" | "route"> & { lines: readonly Line[] } = $props();

  const id = $props.id();

  let chosen = $state<string | undefined>();
  const line = $derived(lines.find((l) => l.series === chosen) ?? lines[0]!);

  const stack = $derived(stackOf(line, lines));

  const data = new ForecastData(() => ({
    core,
    device,
    series: line.series,
    parts: stack.parts,
    route,
  }));

  const note = $derived(
    [line.estimated && m.forecast_estimated_note(), m.forecast_horizon(), m.stats_forecast_note()]
      .filter(Boolean)
      .join(" "),
  );
</script>

<section aria-labelledby="{id}-title" class="flex flex-col gap-3">
  <header class="flex min-h-9 items-center justify-between gap-3">
    <h2 id="{id}-title" class="min-w-0 truncate text-base font-semibold">
      {m.forecast_inverter({ device })}
    </h2>
    {#if lines.length > 1}
      <LinePicker {lines} value={line.series} onpick={(series) => (chosen = series)} />
    {/if}
  </header>

  {#if data.failed}
    <LoadFailed text={m.detail_error()} onretry={data.retry} />
  {:else}
    <RangePane model={data.travel}>
      {#snippet children(p)}
        <ForecastPane got={p.got} up={stack.up} ondrill={data.drill} onbrush={data.brush} />
      {/snippet}
      {#snippet waiting()}
        <ForecastPane got={null} up={stack.up} ondrill={data.drill} onbrush={data.brush} />
      {/snippet}
    </RangePane>
  {/if}

  <p class="max-w-[68ch] text-xs text-pretty text-muted-foreground">{note}</p>
</section>
