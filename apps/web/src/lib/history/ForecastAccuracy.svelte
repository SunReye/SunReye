<!-- How well the forecast did over the range, and where a string's correction is looked into. -->
<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import { Pressable } from "../components/ui/pressable/index.js";
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
  <Pressable
    class="font-medium text-brand underline-offset-2 hover:underline focus-visible:underline"
    onclick={onstrings}>{m.stats_forecast_correction()}</Pressable
  >
</p>
