<!-- Series · Overlay · Fold (ADR 22): which job the chart does for the chosen series. -->
<script lang="ts">
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";
  import { modeLabel } from "./labels.ts";
  import { MODES, type Mode } from "./view.ts";

  let { mode, onchange }: { mode: Mode; onchange: (mode: Mode) => void } = $props();
</script>

<Segmented
  options={MODES.map((id) => [id, modeLabel(id)] as const)}
  value={mode}
  label={m.explore_mode_kind()}
  {onchange}
/>
