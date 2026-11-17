<!-- Settings › Display: this browser's theme, dark or light (ADR 21). -->
<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import SegmentRow from "./SegmentRow.svelte";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  function theme(next: string): void {
    if (next !== "dark" && next !== "light") return;

    setMode(next);
    haptics.selection();
  }
</script>

<SegmentRow
  label={m.display_theme()}
  value={userPrefersMode.current === "light" ? "light" : "dark"}
  options={[
    ["dark", m.display_dark()],
    ["light", m.display_light()],
  ]}
  onchange={theme}
/>
