<!-- Settings › Display: this browser's frame limit for the 3D scene (ADR 21 "Frame limit"). -->
<script lang="ts">
  import SegmentRow from "./SegmentRow.svelte";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { frameLimit } from "../scene/frame-limit.svelte.ts";
  import { FRAME_LIMITS, parseFrameLimit, type FrameLimit } from "../scene/frame-limit.ts";

  /** A limit is its number; only the display's own rate needs a word. */
  const name = (choice: FrameLimit): string =>
    choice === "unlimited" ? m.display_frame_limit_unlimited() : choice;

  function choose(next: string): void {
    // A segment pressed again sends nothing: the choice stays.
    if (next === "" || next === frameLimit.choice) return;

    frameLimit.choice = parseFrameLimit(next);
    haptics.selection();
  }
</script>

<SegmentRow
  label={m.display_frame_limit()}
  value={frameLimit.choice}
  options={FRAME_LIMITS.map((choice) => [choice, name(choice)] as const)}
  hint={m.display_frame_limit_hint()}
  onchange={choose}
/>
