<!-- Settings › Display: this browser's Wettereffekte switch (ADR 23 "Off switch"). -->
<script lang="ts">
  import ToggleRow from "./ToggleRow.svelte";
  import { m } from "../paraglide/messages.js";
  import { weatherEffects } from "@sunreye/builder/scene/weather-effects.svelte.ts";
</script>

<ToggleRow
  label={m.display_weather_effects()}
  hint={m.display_weather_effects_hint()}
  checked={weatherEffects.on}
  onchange={(on) => {
    weatherEffects.on = on;
  }}
/>
