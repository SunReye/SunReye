<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { focusEffects } from "@sunreye/builder/settings";
  import ToggleRow from "./ToggleRow.svelte";
  import WeatherEffectsRow from "./WeatherEffectsRow.svelte";
</script>

<ToggleRow
  label={m.display_tilt_shift()}
  hint={m.display_tilt_shift_hint()}
  checked={focusEffects.tiltShift}
  onchange={(on) => focusEffects.set("tiltShift", on)}
/>
<ToggleRow
  label={m.display_depth_of_field()}
  hint={m.display_depth_of_field_hint()}
  checked={focusEffects.depthOfField}
  onchange={(on) => focusEffects.set("depthOfField", on)}
/>
<WeatherEffectsRow />
