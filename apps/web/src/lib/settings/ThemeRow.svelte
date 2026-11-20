<!-- Settings › Display: this browser's theme, dark or light (ADR 21). -->
<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import SegmentRow from "./SegmentRow.svelte";
  import { m } from "../paraglide/messages.js";
</script>

<SegmentRow
  label={m.display_theme()}
  value={userPrefersMode.current === "light" ? "light" : "dark"}
  options={[
    ["dark", m.display_dark()],
    ["light", m.display_light()],
  ]}
  onchange={setMode}
/>
