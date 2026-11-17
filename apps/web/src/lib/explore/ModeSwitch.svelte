<!-- Series · Overlay · Fold (ADR 22): which job the chart does for the chosen series. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { indicator } from "../range/indicator.ts";
  import { modeLabel } from "./labels.ts";
  import { MODES, type Mode } from "./view.ts";

  let { mode, onchange }: { mode: Mode; onchange: (mode: Mode) => void } = $props();
</script>

<ToggleGroup.Root
  type="single"
  variant="outline"
  size="sm"
  class="data-indicator:before:hidden!"
  aria-label={m.explore_mode_kind()}
  bind:value={
    () => mode,
    (v: string) => {
      const next = MODES.find((each) => each === v);

      if (next === undefined || next === mode) return;

      haptics.selection();
      onchange(next);
    }
  }
>
  <span class="rounded-[2px] bg-foreground/[0.13]" {@attach indicator('[data-state="on"]')}></span>
  {#each MODES as id (id)}
    <ToggleGroup.Item value={id} class="px-2.5 text-xs">{modeLabel(id)}</ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
