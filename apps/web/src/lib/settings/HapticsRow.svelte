<!-- Settings › Display: this browser's haptics switch, held off under low power or reduced motion. -->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import ToggleRow from "./ToggleRow.svelte";
  import { HAPTICS, hapticsOn } from "../haptics.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";

  const touch = new MediaQuery("(pointer: coarse)");

  let stored = $state(localStorage.getItem(HAPTICS));

  const feel = $derived(
    hapticsOn({
      stored,
      touch: touch.current,
      lowPower: motion.held === "low-power",
      reducedMotion: motion.held === "reduced",
    }),
  );

  /** Why haptics are held off, if they are. */
  const held = $derived.by(() => {
    if (motion.held === "low-power") return m.display_haptics_low_power();

    return motion.held === "reduced" ? m.display_haptics_reduced() : undefined;
  });

  function feelOn(on: boolean): void {
    stored = on ? "on" : "off";
    localStorage.setItem(HAPTICS, stored);
  }
</script>

<ToggleRow
  label={m.display_haptics()}
  hint={held ?? m.display_haptics_hint()}
  checked={feel}
  disabled={held !== undefined}
  onchange={feelOn}
/>
