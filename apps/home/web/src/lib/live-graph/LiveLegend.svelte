<!-- The live graph's header: what it shows, or the sample being read, its age and its power
  (ADR 21 "Chart reading"). The axis writes each tick's unit (lib/power.ts). -->
<script lang="ts">
  import { ago } from "../detail/readings.ts";
  import { formatPower } from "../power.ts";
  import type { LiveReading } from "./live-window.ts";

  let {
    reading,
    label,
    warn,
  }: {
    /** The sample under the pointer; null while none is read. */
    reading: LiveReading | null;
    /** What the graph shows, or why it is not current. */
    label: string;
    /** The graph is not current. */
    warn: boolean;
  } = $props();
</script>

<div class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
  {#if reading}
    <span class="font-medium text-foreground tabular-nums">{ago(reading.ago)}</span>
    <span class="font-semibold text-foreground tabular-nums"
      >{reading.watts === null ? "–" : formatPower(reading.watts)}</span
    >
  {:else}
    <span class={["font-medium", warn && "text-warning"]}>{label}</span>
  {/if}
</div>
