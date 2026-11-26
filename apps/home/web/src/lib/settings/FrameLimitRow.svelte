<!-- Settings › Display: this browser's frame limit for the 3D scene (ADR 21 "Frame limit"). -->
<script lang="ts">
  import SegmentRow from "./SegmentRow.svelte";
  import { m } from "../paraglide/messages.js";
  import { frameLimit } from "@sunreye/builder/settings";
  import { FRAME_LIMITS, type FrameLimit } from "@sunreye/builder/settings";

  /** A limit is its number; only the display's own rate needs a word. */
  const name = (choice: FrameLimit): string =>
    choice === "unlimited" ? m.display_frame_limit_unlimited() : choice;
</script>

<SegmentRow
  label={m.display_frame_limit()}
  value={frameLimit.choice}
  options={FRAME_LIMITS.map((choice) => [choice, name(choice)] as const)}
  hint={m.display_frame_limit_hint()}
  onchange={(next) => {
    frameLimit.choice = next;
  }}
/>
