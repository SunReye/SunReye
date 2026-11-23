<!-- Settings › Display: this browser's 3D quality (ADR 20 Look), and what it draws here and now. -->
<script lang="ts">
  import SegmentRow from "./SegmentRow.svelte";
  import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { quality } from "@sunreye/builder/scene/quality.svelte.ts";
  import { QUALITIES, type Quality } from "@sunreye/builder/scene/quality.ts";

  const LEVELS: Readonly<Record<Quality, () => string>> = {
    auto: m.display_quality_auto,
    low: m.display_quality_low,
    medium: m.display_quality_medium,
    high: m.display_quality_high,
    ultra: m.display_quality_ultra,
  };

  /** What the 3D quality does here and now: nothing under low power, and on Auto its level. */
  const drawing = $derived.by(() => {
    if (motion.lowPower) return m.display_quality_low_power();

    return quality.choice === "auto"
      ? m.display_quality_now({ level: LEVELS[quality.look(motion.tier).level]() })
      : m.display_quality_hint();
  });
</script>

<SegmentRow
  label={m.display_quality()}
  value={quality.choice}
  options={QUALITIES.map((level) => [level, LEVELS[level]()] as const)}
  hint={drawing}
  onchange={(next) => {
    quality.choice = next;
  }}
/>
