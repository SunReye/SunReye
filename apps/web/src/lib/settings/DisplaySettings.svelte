<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), frame limit, weather effects (ADR 23), motion, low-power and haptics switches. -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import FrameLimitRow from "./FrameLimitRow.svelte";
  import HapticsRow from "./HapticsRow.svelte";
  import LanguageRow from "./LanguageRow.svelte";
  import LowPowerRow from "./LowPowerRow.svelte";
  import MotionRow from "./MotionRow.svelte";
  import QualityRow from "./QualityRow.svelte";
  import SceneEffectsRows from "./SceneEffectsRows.svelte";
  import ThemeRow from "./ThemeRow.svelte";
</script>

<DrillCard>
  <Item.Group class="gap-0 divide-y divide-border/60">
    <ThemeRow />
    <LanguageRow />
    <QualityRow />
    <FrameLimitRow />
    <SceneEffectsRows />
    <MotionRow />
    <LowPowerRow />
    <HapticsRow />
  </Item.Group>
</DrillCard>
