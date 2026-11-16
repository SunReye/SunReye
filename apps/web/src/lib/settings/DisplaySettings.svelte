<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), low-power and haptics switches. -->
<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import { MediaQuery } from "svelte/reactivity";
  import * as Item from "#lib/components/ui/item/index.js";
  import LanguageRow from "./LanguageRow.svelte";
  import QualityRow from "./QualityRow.svelte";
  import SegmentRow from "./SegmentRow.svelte";
  import ToggleRow from "./ToggleRow.svelte";
  import { HAPTICS, haptics, hapticsOn } from "../haptics.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";

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

  function theme(next: string): void {
    if (next !== "dark" && next !== "light") return;

    setMode(next);
    haptics.selection();
  }

  function feelOn(on: boolean): void {
    stored = on ? "on" : "off";
    localStorage.setItem(HAPTICS, stored);
    haptics.selection();
  }
</script>

<div class="drill-card">
  <Item.Group class="gap-0 divide-y divide-border/60">
    <SegmentRow
      label={m.display_theme()}
      value={userPrefersMode.current === "light" ? "light" : "dark"}
      options={[
        ["dark", m.display_dark()],
        ["light", m.display_light()],
      ]}
      onchange={theme}
    />
    <LanguageRow />
    <QualityRow />
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
