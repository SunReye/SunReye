<!-- The forecast line an inverter's chart shows: its total, an MPPT input or a string. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { indicator } from "../range/indicator.ts";
  import type { Line } from "./forecast.ts";

  let {
    lines,
    value,
    onpick,
  }: { lines: readonly Line[]; value: string; onpick: (series: string) => void } = $props();
</script>

<ToggleGroup.Root
  type="single"
  variant="outline"
  size="sm"
  class="flex-wrap data-indicator:before:hidden!"
  bind:value={
    () => value,
    (v: string) => {
      if (!v || v === value) return;
      haptics.selection();
      onpick(v);
    }
  }
  aria-label={m.forecast_line()}
>
  <span class="rounded-[2px] bg-foreground/[0.13]" {@attach indicator('[data-state="on"]')}></span>
  {#each lines as l (l.series)}
    <ToggleGroup.Item value={l.series} class="px-2.5 text-xs">{l.label}</ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
