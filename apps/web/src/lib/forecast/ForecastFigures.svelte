<!-- How close the forecast came over the range's whole days (prototype ForecastPanel). -->
<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import { accuracyText, type Accuracy } from "../history/forecast.ts";
  import { m } from "../paraglide/messages.js";

  let { accuracy }: { accuracy: Accuracy | null } = $props();

  const acc = $derived(
    accuracyText(accuracy ?? { error: null, bias: null, days: 0 }, accuracy === null),
  );
</script>

<StatStrip
  stats={[
    { label: m.stats_forecast_error(), value: acc[0] },
    { label: m.stats_forecast_bias(), value: acc[1] },
    { label: m.stats_forecast_days(), value: acc[2] },
  ]}
/>
