<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), weather effects (ADR 23), low-power and haptics switches. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import HapticsRow from "./HapticsRow.svelte";
  import LanguageRow from "./LanguageRow.svelte";
  import QualityRow from "./QualityRow.svelte";
  import ThemeRow from "./ThemeRow.svelte";
  import ToggleRow from "./ToggleRow.svelte";
  import WeatherEffectsRow from "./WeatherEffectsRow.svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
</script>

<div class="drill-card">
  <Item.Group class="gap-0 divide-y divide-border/60">
    <ThemeRow />
    <LanguageRow />
    <QualityRow />
    <WeatherEffectsRow />
    <ToggleRow
      label={m.display_low_power()}
      hint={m.display_low_power_hint()}
      checked={motion.lowPower}
      onchange={(on) => {
        motion.lowPower = on;
      }}
    />
    <HapticsRow />
  </Item.Group>
</div>
