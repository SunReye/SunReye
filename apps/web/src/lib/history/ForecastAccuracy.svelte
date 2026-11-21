<!-- How well the forecast did over the range, and where a string's correction is looked into. -->
<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import TextLink from "../components/text-link.svelte";
  import { m } from "../paraglide/messages.js";

  let {
    acc,
    onstrings,
  }: {
    /** The mean error, the bias and the days compared, as text. */
    acc: readonly [string, string, string];
    onstrings: () => void;
  } = $props();
</script>

<StatStrip
  stats={[
    { label: m.stats_forecast_error(), value: acc[0] },
    { label: m.stats_forecast_bias(), value: acc[1] },
    { label: m.stats_forecast_days(), value: acc[2] },
  ]}
/>
<p class="max-w-[68ch] text-xs text-muted-foreground">
  {m.stats_forecast_note()}
  <TextLink onclick={onstrings}>{m.stats_forecast_correction()}</TextLink>
</p>
