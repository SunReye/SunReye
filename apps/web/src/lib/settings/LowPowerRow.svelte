<!-- Settings › Display: this browser's low-power switch (ADR 21 "Off switches"). -->
<script lang="ts">
  import ToggleRow from "./ToggleRow.svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
</script>

<ToggleRow
  label={m.display_low_power()}
  hint={m.display_low_power_hint()}
  checked={motion.lowPower}
  onchange={(on) => {
    motion.lowPower = on;
  }}
/>
