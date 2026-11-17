<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), weather effects (ADR 23), low-power and haptics switches. -->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import * as Item from "#lib/components/ui/item/index.js";
  import LanguageRow from "./LanguageRow.svelte";
  import QualityRow from "./QualityRow.svelte";
  import ThemeRow from "./ThemeRow.svelte";
  import ToggleRow from "./ToggleRow.svelte";
  import { HAPTICS, haptics, hapticsOn } from "../haptics.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { weatherEffects } from "../scene/effects.svelte.ts";

  const touch = new MediaQuery("(pointer: coarse)");
  const reduce = new MediaQuery("(prefers-reduced-motion: reduce)");

  let stored = $state(localStorage.getItem(HAPTICS));

  const feel = $derived(
    hapticsOn({
      stored,
      touch: touch.current,
      lowPower: motion.lowPower,
      reducedMotion: reduce.current,
    }),
  );

  /** Why haptics are held off, if they are. */
  const held = $derived.by(() => {
    if (motion.lowPower) return m.display_haptics_low_power();

    return reduce.current ? m.display_haptics_reduced() : undefined;
  });

  function feelOn(on: boolean): void {
    stored = on ? "on" : "off";
    localStorage.setItem(HAPTICS, stored);
    haptics.selection();
  }
</script>

<div class="drill-card">
  <Item.Group class="gap-0 divide-y divide-border/60">
    <ThemeRow />
    <LanguageRow />
    <QualityRow />
    <ToggleRow
      label={m.display_weather_effects()}
      hint={m.display_weather_effects_hint()}
      checked={weatherEffects.on}
      onchange={(on) => {
        weatherEffects.on = on;
        haptics.selection();
      }}
    />
    <ToggleRow
      label={m.display_low_power()}
      hint={m.display_low_power_hint()}
      checked={motion.lowPower}
      onchange={(on) => {
        motion.lowPower = on;
      }}
    />
    <ToggleRow
      label={m.display_haptics()}
      hint={held ?? m.display_haptics_hint()}
      checked={feel}
      disabled={held !== undefined}
      onchange={feelOn}
    />
  </Item.Group>
</div>
