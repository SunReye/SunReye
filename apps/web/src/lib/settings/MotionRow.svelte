<!-- Settings › Display: this browser's motion setting (ADR 21), and what moves here and now. -->
<script lang="ts">
  import TextLink from "../components/text-link.svelte";
  import SegmentRow from "./SegmentRow.svelte";
  import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
  import { MOTION_SETTINGS, type MotionSetting } from "@sunreye/builder/motion/tier.ts";
  import { m } from "../paraglide/messages.js";

  const CHOICES: Readonly<Record<MotionSetting, () => string>> = {
    auto: m.display_motion_auto,
    full: m.display_motion_full,
    lite: m.display_motion_lite,
  };

  /** Shown only on Automatisch with nothing holding the device still: what the watch measured. */
  const measuring = $derived(motion.setting === "auto" && motion.held === null);

  /** What moves here and now: still under an off switch, else the watch's tier or the choice. */
  const moving = $derived.by(() => {
    if (motion.held === "low-power") return m.display_motion_low_power();

    if (motion.held === "reduced") return m.display_motion_reduced();

    return measuring
      ? m.display_motion_measured({ tier: CHOICES[motion.measured === "lite" ? "lite" : "full"]() })
      : m.display_motion_hint();
  });
</script>

<SegmentRow
  label={m.display_motion()}
  value={motion.setting}
  options={MOTION_SETTINGS.map((setting) => [setting, CHOICES[setting]()] as const)}
  hint={moving}
  onchange={(next) => {
    motion.setting = next;
  }}
>
  {#if measuring && motion.stepped}
    <TextLink onclick={() => motion.remeasure()} class="self-start text-xs">
      {m.display_motion_remeasure()}
    </TextLink>
  {/if}
</SegmentRow>
