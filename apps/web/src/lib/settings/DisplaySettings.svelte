<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), frame limit, weather effects (ADR 23), motion, low-power and haptics switches. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import FrameLimitRow from "./FrameLimitRow.svelte";
  import HapticsRow from "./HapticsRow.svelte";
  import LanguageRow from "./LanguageRow.svelte";
  import LowPowerRow from "./LowPowerRow.svelte";
  import MotionRow from "./MotionRow.svelte";
  import QualityRow from "./QualityRow.svelte";
  import ThemeRow from "./ThemeRow.svelte";
  import WeatherEffectsRow from "./WeatherEffectsRow.svelte";
</script>

<div class="drill-card">
  <Item.Group class="gap-0 divide-y divide-border/60">
    <ThemeRow />
    <LanguageRow />
    <QualityRow />
    <FrameLimitRow />
    <WeatherEffectsRow />
    <MotionRow />
    <LowPowerRow />
    <HapticsRow />
  </Item.Group>
</div>
